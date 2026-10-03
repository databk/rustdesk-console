// Executed only by CI: node --test agent/*.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent, REDACTED, validateBans, validateConfig } from './app.mjs';
import { DockerDriver } from './docker.mjs';

const token = 'a'.repeat(40);
const serverToken = 'b'.repeat(40);
const container = (service = 'hbbs') => ({
  Id: 'old',
  State: { Running: true, Status: 'running' },
  Config: {
    Image: 'managed:test',
    Cmd: [service],
    Labels: {
      'io.rustdesk.console.node': 'local',
      'io.rustdesk.console.service': service,
      'io.rustdesk.console.port': '21116',
    },
    ExposedPorts: {
      '21115/tcp': {},
      '21116/tcp': {},
      '21116/udp': {},
      '21118/tcp': {},
      '21120/tcp': {},
    },
  },
  HostConfig: {
    Binds: ['/host/data:/data'],
    PortBindings: {
      '21115/tcp': [{ HostPort: '21115' }],
      '21116/tcp': [{ HostPort: '21116' }],
      '21116/udp': [{ HostPort: '21116' }],
      '21118/tcp': [{ HostPort: '21118' }],
    },
  },
  NetworkSettings: { Networks: { net: { Aliases: ['hbbs'] } } },
});

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rustdesk-agent-'));
  const calls = [];
  const docker = {
    inspect: async (service) => container(service),
    apply: async (_service, port, ready, _rollback, commit) => {
      await ready(port);
      await commit();
    },
    logs: async () => `Key: private-value\ntoken=${serverToken}\nnormal log`,
    action: async () => {},
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.authorization, `Bearer ${serverToken}`);
    const service = new URL(url).hostname;
    if (url.endsWith('/status'))
      return Response.json({ service, api_version: 1, uptime_seconds: 2 });
    if (url.endsWith('/config'))
      return Response.json({
        values: { port: service === 'hbbs' ? '21116' : '21117', key: REDACTED },
      });
    return Response.json({ state: 'applied', data: [] });
  };
  const agent = createAgent({
    token,
    serverToken,
    directory,
    docker,
    fetcher,
    readinessAttempts: 1,
    ...overrides,
  });
  const server = agent.server();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const request = async (route, method = 'GET', body, authorized = true) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      headers: {
        ...(authorized ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { request, directory, calls, docker, agent };
}

test('authorization is required even for status; arbitrary Docker commands are unavailable', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request('/v1/status', 'GET', undefined, false)).status,
    401,
  );
  assert.equal((await request('/v1/services/other/stop', 'POST')).status, 404);
  assert.equal(
    (await request('/v1/services/hbbs/exec', 'POST', { command: 'anything' }))
      .status,
    404,
  );
});

test('saving configuration preserves redacted keys and does not restart a service', async (t) => {
  const { request, directory, docker } = await fixture(t);
  let applied = false;
  docker.apply = async () => {
    applied = true;
  };
  await fs.writeFile(
    path.join(directory, 'hbbs-config.json'),
    JSON.stringify({ values: { key: 'private-value' } }),
  );
  const response = await request('/v1/services/hbbs/config', 'PUT', {
    values: { key: REDACTED, port: '22016' },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.values.key, REDACTED);
  assert.equal(result.pending_restart, true);
  assert.equal(applied, false);
  const persisted = JSON.parse(
    await fs.readFile(path.join(directory, 'hbbs-config.json'), 'utf8'),
  );
  assert.equal(persisted.values.key, 'private-value');
});

test('an apply failure restores the last applied document', async (t) => {
  const { request, directory, docker } = await fixture(t);
  const previous = { values: { port: '21116', key: 'previous-key' } };
  await fs.writeFile(
    path.join(directory, 'hbbs-applied.json'),
    JSON.stringify(previous),
  );
  await fs.writeFile(
    path.join(directory, 'hbbs-config.json'),
    JSON.stringify({ values: { port: '22016' } }),
  );
  docker.apply = async (_service, _port, _ready, rollback) => {
    await rollback();
    throw new Error('Failed readiness');
  };
  assert.equal((await request('/v1/services/hbbs/apply', 'POST')).status, 500);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(directory, 'hbbs-config.json'), 'utf8'),
    ),
    previous,
  );
});

test('offline services leave persisted policy pending and receive it after recovery', async (t) => {
  let offline = true;
  const applied = [];
  const { request, agent } = await fixture(t, {
    fetcher: async (url, options) => {
      if (offline && url.includes('hbbr')) throw new Error('Offline');
      applied.push(JSON.parse(options.body));
      return Response.json({ state: 'applied' });
    },
  });
  const rules = { device_ids: ['123456'], ips: ['192.0.2.1'] };
  const first = await (await request('/v1/bans', 'PUT', rules)).json();
  assert.equal(first.synchronization.hbbr.state, 'pending');
  offline = false;
  const next = await agent.syncPolicy();
  assert.equal(next.synchronization.hbbr.state, 'applied');
  assert.deepEqual(applied.at(-1), rules);
});

test('invalid settings, nonfinite limits and invalid ban entries fail validation', () => {
  assert.throws(() => validateConfig('hbbs', { values: { port: '65535' } }));
  assert.throws(() =>
    validateConfig('hbbr', { values: { 'total-bandwidth': 'Infinity' } }),
  );
  assert.throws(() =>
    validateConfig('hbbs', { values: { RD_MANAGEMENT_TOKEN: 'secret' } }),
  );
  assert.throws(() => validateBans({ device_ids: [''], ips: [] }));
  assert.throws(() => validateBans({ device_ids: [], ips: ['not-an-ip'] }));
  assert.deepEqual(
    validateBans({
      device_ids: ['123456', '123456'],
      ips: ['::ffff:192.0.2.1'],
    }),
    { device_ids: ['123456'], ips: ['192.0.2.1'] },
  );
});

test('integer settings are serialized in the decimal format parsed by the server', () => {
  assert.deepEqual(
    validateConfig('hbbs', { values: { port: '21116.0', serial: '1e2' } }),
    { values: { port: '21116', serial: '100' } },
  );
});

test('log responses remove management credentials and key values', async (t) => {
  const { request } = await fixture(t);
  const result = await (await request('/v1/services/hbbs/logs')).json();
  assert.ok(!result.text.includes(serverToken));
  assert.ok(!result.text.includes('private-value'));
  assert.ok(result.text.includes('normal log'));
});

test('Docker enrollment fails closed before any lifecycle operation', async () => {
  const calls = [];
  const docker = new DockerDriver({
    request: async (method, path) => {
      calls.push({ method, path });
      const info = container();
      info.Config.Labels['io.rustdesk.console.node'] = 'other';
      return info;
    },
  });
  await assert.rejects(docker.action('hbbs', 'stop'), /not enrolled/);
  assert.equal(calls.length, 1);
});

test('port recreation preserves host bindings and volumes even for overlapping ranges', async () => {
  const calls = [];
  const docker = new DockerDriver({
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.endsWith('/json')) return container();
      if (path.startsWith('/containers/create')) return { Id: 'new' };
    },
  });
  await docker.apply(
    'hbbs',
    21117,
    async () => {},
    async () => {},
  );
  const creation = calls.find((call) =>
    call.path.startsWith('/containers/create'),
  ).body;
  assert.deepEqual(creation.HostConfig.Binds, ['/host/data:/data']);
  assert.deepEqual(creation.HostConfig.PortBindings['21117/tcp'], [
    { HostPort: '21116' },
  ]);
  assert.deepEqual(creation.NetworkingConfig.EndpointsConfig.net.Aliases, [
    'hbbs',
  ]);
  assert.equal(creation.Labels['io.rustdesk.console.port'], '21117');
  assert.equal(creation.Labels['io.rustdesk.console.deployment-port'], '21116');
  assert.ok(
    calls.some((call) => call.method === 'DELETE' && call.path.includes('v=0')),
  );
});

test('failed replacement restores configuration before restoring the original container', async () => {
  const calls = [];
  const docker = new DockerDriver({
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.endsWith('/json')) return container();
      if (path.startsWith('/containers/create')) return { Id: 'new' };
    },
  });
  let healthChecks = 0;
  await assert.rejects(
    docker.apply(
      'hbbs',
      22016,
      async () => {
        if (++healthChecks === 1) throw new Error('Unhealthy replacement');
      },
      async () => {
        calls.push({ path: 'restore-config' });
      },
    ),
    /Unhealthy replacement/,
  );
  const restore = calls.findIndex((call) => call.path === 'restore-config');
  const startOld = calls.findIndex(
    (call) => call.path === '/containers/old/start',
  );
  assert.ok(restore >= 0 && restore < startOld);
  assert.ok(
    !calls.some(
      (call) => call.method === 'DELETE' && call.path.includes('/old?'),
    ),
  );
});

test('oversized authenticated bodies return 413 without applying configuration', async (t) => {
  const { request, directory } = await fixture(t);
  const response = await request('/v1/services/hbbs/config', 'PUT', {
    values: { key: 'x'.repeat(129 * 1024) },
  });
  assert.equal(response.status, 413);
  await assert.rejects(fs.access(path.join(directory, 'hbbs-config.json')));
});

test('invalid server JSON is reported as an upstream failure', async (t) => {
  const { request } = await fixture(t, {
    fetcher: async () => new Response('not JSON'),
  });
  assert.equal((await request('/v1/peers')).status, 502);
});

test('removing a port override restores the immutable deployment port', async (t) => {
  const { request, directory, docker } = await fixture(t);
  const info = container('hbbr');
  info.Config.Labels['io.rustdesk.console.port'] = '22117';
  info.Config.Labels['io.rustdesk.console.deployment-port'] = '21117';
  docker.inspect = async () => info;
  await fs.writeFile(
    path.join(directory, 'hbbr-applied.json'),
    JSON.stringify({ values: { port: '22117' } }),
  );
  await fs.writeFile(
    path.join(directory, 'hbbr-config.json'),
    JSON.stringify({ values: {} }),
  );
  let appliedPort;
  docker.apply = async (_service, port, ready, _rollback, commit) => {
    appliedPort = port;
    await ready(port);
    await commit();
  };
  assert.equal((await request('/v1/services/hbbr/apply', 'POST')).status, 200);
  assert.equal(appliedPort, 21117);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(directory, 'hbbr-applied.json'), 'utf8'),
    ),
    { values: {} },
  );
});

test('management readiness rejects a listener that does not match container bindings', async (t) => {
  const { request, directory } = await fixture(t);
  await request('/v1/services/hbbs/config', 'PUT', {
    values: { port: '22016' },
  });
  const response = await request('/v1/services/hbbs/apply', 'POST');
  assert.equal(response.status, 503);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(directory, 'hbbs-config.json'), 'utf8'),
    ),
    { values: {} },
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(directory, 'hbbs-applied.json'), 'utf8'),
    ),
    { values: {} },
  );
});

test('rollback attempts every recovery step and preserves the original failure', async () => {
  const original = new Error('Unhealthy replacement');
  const calls = [];
  const ports = [];
  const info = container();
  info.NetworkSettings.Networks.second = { Aliases: ['hbbs'] };
  const docker = new DockerDriver({
    request: async (method, route, body) => {
      calls.push({ method, route, body });
      if (route.endsWith('/json')) return info;
      if (route.startsWith('/containers/create')) return { Id: 'new' };
      if (
        route === '/containers/new?force=1&v=0' ||
        route === '/containers/old/rename?name=hbbs' ||
        route === '/networks/net/connect' ||
        route === '/containers/old/start'
      )
        throw new Error('Recovery step failed');
    },
  });
  await assert.rejects(
    docker.apply(
      'hbbs',
      22016,
      async (port) => {
        ports.push(port);
        if (ports.length === 1) throw original;
      },
      async () => {
        throw new Error('Configuration restore failed');
      },
    ),
    (error) => {
      assert.equal(error, original);
      assert.deepEqual(error.rollbackFailures, [
        'configuration',
        'remove-replacement',
        'restore-name',
        'reconnect-net',
        'start',
      ]);
      return true;
    },
  );
  assert.deepEqual(ports, [22016, 21116]);
  assert.ok(calls.some((call) => call.route === '/networks/second/connect'));
  assert.ok(calls.some((call) => call.route === '/containers/old/start'));
});

test('same-port rollback still restarts and checks the old service if restoring configuration fails', async () => {
  const calls = [];
  const original = new Error('Unhealthy service');
  let checks = 0;
  const docker = new DockerDriver({
    request: async (method, route) => {
      calls.push({ method, route });
      if (route.endsWith('/json')) return container();
    },
  });
  await assert.rejects(
    docker.apply(
      'hbbs',
      21116,
      async (port) => {
        assert.equal(port, 21116);
        if (++checks === 1) throw original;
      },
      async () => {
        throw new Error('Configuration restore failed');
      },
    ),
    (error) => error === original,
  );
  assert.equal(checks, 2);
  assert.equal(
    calls.filter((call) => call.route === '/containers/old/restart?t=10')
      .length,
    2,
  );
});

test('every returned configuration representation masks schema-marked secrets', async (t) => {
  const { request } = await fixture(t, {
    fetcher: async () =>
      Response.json({
        values: { key: 'unmasked-server-secret', port: '21116' },
      }),
  });
  const response = await request('/v1/services/hbbs/config');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.values.key, REDACTED);
  assert.equal(result.effective_values.key, REDACTED);
  assert.ok(!JSON.stringify(result).includes('unmasked-server-secret'));
});

for (const port of [21116, 22016]) {
  test(`failed applied-state checkpoint rolls back the runtime before deleting backup (port ${port})`, async () => {
    const docker = new DockerDriver({ nodeId: 'local' });
    docker.inspect = async () => container();
    const calls = [];
    docker.request = async (method, route) => {
      calls.push({ method, route });
      if (route.startsWith('/containers/create')) return { Id: 'replacement' };
      return {};
    };
    const checked = [];
    let restored = false;
    const failure = new Error('Checkpoint write failed');
    await assert.rejects(
      docker.apply(
        'hbbs',
        port,
        async (value) => checked.push(value),
        async () => {
          restored = true;
        },
        async () => {
          throw failure;
        },
      ),
      (error) => error === failure,
    );
    assert.equal(restored, true);
    assert.deepEqual(checked, [port, 21116]);
    assert.ok(
      !calls.some(
        ({ method, route }) =>
          method === 'DELETE' && route.startsWith('/containers/old?'),
      ),
    );
    if (port !== 21116)
      assert.ok(calls.some(({ route }) => route === '/containers/old/start'));
  });
}
