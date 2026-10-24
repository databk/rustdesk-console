import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const nativeServices = ['hbbs', 'hbbr'];
const consoleServices = ['rustdesk-console', 'rustdesk-console-web', 'updater'];

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'console-server-profile-'));
  const project = `console-server-${randomBytes(6).toString('hex')}`;
  const token = randomBytes(32).toString('hex');
  const source = await fs.readFile(
    join(repository, 'docker-compose.yml'),
    'utf8',
  );
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('COMPOSE_')) delete environment[key];
  }
  for (const [, key] of source.matchAll(/\$\{([A-Za-z_][A-Za-z_0-9]*)/g)) {
    delete environment[key];
  }
  await fs.writeFile(join(root, 'docker-compose.yml'), source);
  await fs.writeFile(
    join(root, '.env'),
    [
      'JWT_SECRET=isolated-server-profile-test',
      'ADMIN_PASSWORD=isolated-server-profile-test',
      `CONSOLE_INSTALL_DIR=${root.replaceAll('\\', '/')}`,
      `SERVER_MANAGEMENT_TOKEN=${token}`,
      'RUSTDESK_RELAY_ADDRESS=hbbr:21117',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  const docker = async (...args) => {
    const result = await execute('docker', args, {
      cwd: root,
      env: environment,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout.trim();
  };
  const compose = (file, ...args) =>
    docker(
      'compose',
      '--project-name',
      project,
      '--env-file',
      join(root, '.env'),
      '--file',
      join(root, file),
      ...args,
    );
  const config = async (server = false) =>
    JSON.parse(
      await compose(
        'docker-compose.yml',
        ...(server ? ['--profile', 'server'] : []),
        'config',
        '--format',
        'json',
      ),
    );
  let deployed = false;
  t.after(async () => {
    if (deployed) {
      const ids = (await compose('native.json', 'ps', '--all', '--quiet'))
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        const [container] = JSON.parse(
          await docker('container', 'inspect', id),
        );
        assert.equal(
          container.Config.Labels['com.docker.compose.project'],
          project,
          'cleanup must only remove this test project',
        );
      }
      await compose('native.json', 'down', '--timeout', '10');
    }
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
      // Native containers write bind-mounted files as root. On CI runners the
      // test process cannot unlink them, so reuse the same engine to remove the
      // root-owned data subtree with root privileges, then retry the cleanup.
      await docker(
        'run',
        '--rm',
        '--volume',
        `${root}:/cleanup`,
        'alpine:3.20',
        'rm',
        '-rf',
        '/cleanup/data',
      );
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  return {
    root,
    token,
    docker,
    compose,
    config,
    markDeployed: () => {
      deployed = true;
    },
  };
}

test('default services and server profile preserve the Compose contract', async (t) => {
  const f = await fixture(t);
  const standard = await f.config();
  const server = await f.config(true);
  assert.deepEqual(
    Object.keys(standard.services).sort(),
    consoleServices.toSorted(),
  );
  assert.deepEqual(
    Object.keys(server.services).sort(),
    [...consoleServices, ...nativeServices].sort(),
  );
  for (const name of consoleServices) {
    assert.deepEqual(server.services[name], standard.services[name]);
  }
  for (const [name, directory] of [
    ['hbbs', 'server'],
    ['hbbr', 'server-relay'],
  ]) {
    const service = server.services[name];
    assert.equal(service.working_dir, '/data');
    assert.equal(service.environment.HOME, '/data');
    assert.deepEqual(
      service.volumes.map(({ type, source, target }) => ({
        type,
        source: source.replaceAll('\\', '/'),
        target,
      })),
      [
        {
          type: 'bind',
          source: join(f.root, 'data', directory).replaceAll('\\', '/'),
          target: '/data',
        },
      ],
    );
  }
  assert.equal(
    server.services.hbbs.environment.RD_MANAGEMENT_DIR,
    '/data/management',
  );
  assert.equal(
    server.services.hbbr.environment.RD_HBBS_API_URL,
    'ws://hbbs:21120/v1/control',
  );
});

async function waitFor(description, read, accept, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError });
}

// Minimal RegisterPk wire fixture from hbb_common/protos/rendezvous.proto:
// RendezvousMessage.register_pk = 15; RegisterPk id/uuid/pk = 1/2/3.
async function registerPeer(port, peer) {
  const fields = [Buffer.from(peer.id), peer.uuid, peer.pk];
  const body = Buffer.concat(
    fields.map((value, index) =>
      Buffer.concat([
        Buffer.from([((index + 1) << 3) | 2, value.length]),
        value,
      ]),
    ),
  );
  const message = Buffer.concat([Buffer.from([0x7a, body.length]), body]);
  const socket = createSocket('udp4');
  try {
    const response = await new Promise((resolveResponse, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('RegisterPk timed out')),
        5_000,
      );
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.once('message', (reply) => {
        clearTimeout(timeout);
        resolveResponse(reply);
      });
      socket.send(message, port, '127.0.0.1');
    });
    // Field 16 contains RegisterPkResponse; OK is protobuf's omitted zero enum.
    assert.deepEqual(response, Buffer.from([0x82, 0x01, 0x00]));
  } finally {
    socket.close();
  }
}

async function inspectDatabase(path, peer) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      database.prepare('PRAGMA quick_check').get().quick_check,
      'ok',
    );
    const row = database
      .prepare(
        'SELECT id, hex(uuid) AS uuid, hex(pk) AS pk FROM peer WHERE id = ?',
      )
      .get(peer.id);
    assert.ok(row, 'the protocol registration must have a persisted peer row');
    assert.equal(row.uuid, peer.uuid.toString('hex').toUpperCase());
    assert.equal(row.pk, peer.pk.toString('hex').toUpperCase());
    return { ...row };
  } finally {
    database.close();
  }
}

test(
  'published native image registers the relay and preserves state after recreation',
  { timeout: 300_000 },
  async (t) => {
    const f = await fixture(t);
    const engine = JSON.parse(await f.docker('info', '--format', '{{json .}}'));
    assert.equal(
      engine.OSType,
      'linux',
      'this integration requires a running Linux Docker engine',
    );
    const source = await f.config(true);
    const services = {};
    for (const [name, directory] of [
      ['hbbs', 'server'],
      ['hbbr', 'server-relay'],
    ]) {
      // Preserve the real image, command, CWD, HOME, management URL and /data
      // target. Only host resources and project identities are isolated.
      const service = structuredClone(source.services[name]);
      delete service.container_name;
      delete service.profiles;
      service.restart = 'no';
      service.networks = { native: {} };
      service.ports =
        name === 'hbbs'
          ? [
              {
                target: 21120,
                published: '0',
                host_ip: '127.0.0.1',
                protocol: 'tcp',
              },
              {
                target: 21116,
                published: '0',
                host_ip: '127.0.0.1',
                protocol: 'udp',
              },
            ]
          : [];
      service.cpus = 1;
      service.mem_limit = '512m';
      service.pids_limit = 128;
      services[name] = service;
      const data = join(f.root, 'data', directory);
      for (const child of [
        '',
        '.config',
        name === 'hbbs' ? 'management' : '.management',
      ]) {
        await fs.mkdir(join(data, child), { recursive: true });
      }
      await fs.writeFile(
        join(data, '.config', 'profile-fixture'),
        `home-${name}`,
      );
    }
    const relayData = join(f.root, 'data', 'server-relay');
    await fs.writeFile(join(relayData, 'blacklist.txt'), '192.0.2.7');
    await fs.writeFile(join(relayData, 'blocklist.txt'), '198.51.100.7');
    await fs.writeFile(
      join(f.root, 'native.json'),
      JSON.stringify({ services, networks: { native: {} } }),
      { mode: 0o600 },
    );
    await f.compose('native.json', 'pull', ...nativeServices);
    for (const image of new Set(
      nativeServices.map((name) => services[name].image),
    )) {
      const [metadata] = JSON.parse(await f.docker('image', 'inspect', image));
      t.diagnostic(
        `Native image: ${image}; ${metadata.Os}/${metadata.Architecture}; ${metadata.Id}; ${(metadata.RepoDigests ?? []).join(', ')}`,
      );
    }
    f.markDeployed();
    await f.compose(
      'native.json',
      'up',
      '-d',
      '--pull',
      'never',
      ...nativeServices,
    );

    const containerId = async (name) =>
      f.compose('native.json', 'ps', '--all', '--quiet', name);
    const hbbsId = await containerId('hbbs');
    const hbbrId = await containerId('hbbr');
    for (const id of [hbbsId, hbbrId]) {
      const [container] = JSON.parse(
        await f.docker('container', 'inspect', id),
      );
      assert.equal(container.Config.WorkingDir, '/data');
      assert.ok(container.Config.Env.includes('HOME=/data'));
    }
    const [hbbs] = JSON.parse(await f.docker('container', 'inspect', hbbsId));
    const managementPort = Number(
      hbbs.NetworkSettings.Ports['21120/tcp'][0].HostPort,
    );
    const udpPort = Number(hbbs.NetworkSettings.Ports['21116/udp'][0].HostPort);
    let base = `http://127.0.0.1:${managementPort}`;
    const request = async (path, method = 'GET', body) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${f.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(3_000),
      });
      assert.equal(response.status, 200, `${method} ${path}`);
      return response.json();
    };
    const ready = async () => {
      const status = await waitFor(
        'hbbs status',
        () => request('/v1/status'),
        (value) => value.service === 'hbbs',
      );
      await waitFor(
        'registered relay-1',
        () => request('/v1/relays'),
        (value) =>
          value.data?.some(
            (relay) => relay.id === 'relay-1' && relay.address === 'hbbr:21117',
          ),
      );
      await request('/v1/relays/relay-1/config');
      return status;
    };
    const status = await ready();
    const denied = await fetch(`${base}/v1/relays`, {
      signal: AbortSignal.timeout(3_000),
    });
    assert.equal(denied.status, 401);
    await denied.body?.cancel();
    const peer = {
      id: 'profile-fixture',
      uuid: randomBytes(16),
      pk: randomBytes(32),
    };
    await registerPeer(udpPort, peer);
    await waitFor(
      'the protocol peer in the native snapshot',
      () => request('/v1/peers'),
      (value) => value.data?.some((row) => row.id === peer.id),
    );
    const relayConfig = await request('/v1/relays/relay-1/config', 'PUT', {
      values: { 'limit-speed': '64' },
    });
    assert.equal(relayConfig.state, 'saved');
    assert.equal(relayConfig.applied['limit-speed'], '64');
    await request('/v1/config', 'PUT', { values: { 'always-use-relay': 'Y' } });
    const bans = { device_ids: ['999991'], ips: ['192.0.2.9'] };
    await request('/v1/bans', 'PUT', bans);
    await waitFor(
      'relay ban persistence',
      async () =>
        JSON.parse(
          await fs.readFile(
            join(relayData, '.management', 'hbbr-bans.json'),
            'utf8',
          ),
        ),
      (value) => JSON.stringify(value) === JSON.stringify(bans),
    );
    assert.equal(
      (await request('/v1/relays/relay-1/config')).values['limit-speed'],
      '64',
    );

    const snapshot = async (name) => {
      const destination = join(f.root, name);
      await fs.mkdir(destination);
      for (const service of nativeServices) {
        const target = join(destination, service);
        await fs.mkdir(target);
        await f.docker('cp', `${await containerId(service)}:/data/.`, target);
      }
      return destination;
    };
    const hash = async (path) =>
      createHash('sha256')
        .update(await fs.readFile(path))
        .digest('hex');
    await f.compose(
      'native.json',
      'stop',
      '--timeout',
      '10',
      ...nativeServices,
    );
    const before = await snapshot('before');
    const originalPeer = await inspectDatabase(
      join(before, 'hbbs', 'db_v2.sqlite3'),
      peer,
    );
    const publicKey = (
      await fs.readFile(join(before, 'hbbs', 'id_ed25519.pub'), 'utf8')
    ).trim();
    assert.equal(status.public_key, publicKey);
    const identity = await Promise.all(
      ['id_ed25519', 'id_ed25519.pub'].map((name) =>
        hash(join(before, 'hbbs', name)),
      ),
    );
    await f.compose(
      'native.json',
      'up',
      '-d',
      '--force-recreate',
      '--pull',
      'never',
      ...nativeServices,
    );
    assert.notEqual(await containerId('hbbs'), hbbsId);
    assert.notEqual(await containerId('hbbr'), hbbrId);
    const [recreated] = JSON.parse(
      await f.docker('container', 'inspect', await containerId('hbbs')),
    );
    base = `http://127.0.0.1:${recreated.NetworkSettings.Ports['21120/tcp'][0].HostPort}`;
    assert.equal((await ready()).public_key, publicKey);
    assert.equal((await request('/v1/config')).values['always-use-relay'], 'Y');
    assert.equal(
      (await request('/v1/relays/relay-1/config')).values['limit-speed'],
      '64',
    );
    assert.deepEqual(await request('/v1/bans'), bans);
    const relayLogs = await f.compose(
      'native.json',
      'logs',
      '--no-color',
      'hbbr',
    );
    assert.match(relayLogs, /#blacklist\(blacklist\.txt\): 1/);
    assert.match(relayLogs, /#blocklist\(blocklist\.txt\): 1/);
    await f.compose(
      'native.json',
      'stop',
      '--timeout',
      '10',
      ...nativeServices,
    );
    const after = await snapshot('after');
    assert.deepEqual(
      await inspectDatabase(join(after, 'hbbs', 'db_v2.sqlite3'), peer),
      originalPeer,
    );
    assert.deepEqual(
      await Promise.all(
        ['id_ed25519', 'id_ed25519.pub'].map((name) =>
          hash(join(after, 'hbbs', name)),
        ),
      ),
      identity,
    );
    for (const [service, paths] of [
      [
        'hbbs',
        [
          '.config/profile-fixture',
          'management/hbbs-config.json',
          'management/hbbs-bans.json',
        ],
      ],
      [
        'hbbr',
        [
          '.config/profile-fixture',
          '.management/hbbr-config.json',
          '.management/hbbr-bans.json',
          'blacklist.txt',
          'blocklist.txt',
        ],
      ],
    ]) {
      for (const path of paths) {
        assert.equal(
          await hash(join(after, service, path)),
          await hash(join(before, service, path)),
          `${service}/${path} must survive recreation`,
        );
      }
    }
    t.diagnostic(
      'Verified real RegisterPk row, SQLite integrity, unchanged key pair, relay proxy configuration, ban fanout, HOME fixture and CWD lists after recreation.',
    );
  },
);
