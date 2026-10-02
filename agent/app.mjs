import http from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentError, DockerDriver } from './docker.mjs';

export const REDACTED = '__REDACTED__';
export const schema = JSON.parse(
  await fs.readFile(new URL('./schema.json', import.meta.url), 'utf8'),
);
const services = ['hbbs', 'hbbr'];

export function validateConfig(service, input, previous = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== 'values') ||
    !input.values ||
    typeof input.values !== 'object' ||
    Array.isArray(input.values)
  )
    throw new AgentError(400, 'Expected a values object');
  const values = {};
  for (const [name, value] of Object.entries(input.values)) {
    const definition = schema[service].find((item) => item.name === name);
    if (
      !definition ||
      typeof value !== 'string' ||
      value.length > 4096 ||
      value.includes('\0')
    )
      throw new AgentError(400, `Invalid setting: ${name}`);
    if (value === REDACTED) {
      if (!definition.secret)
        throw new AgentError(400, `Invalid placeholder: ${name}`);
      if (Object.hasOwn(previous, name)) values[name] = previous[name];
      continue;
    }
    if (definition.kind === 'integer' || definition.kind === 'number') {
      const number = Number(value);
      if (
        !value.trim() ||
        !Number.isFinite(number) ||
        number < definition.minimum ||
        number > definition.maximum ||
        (definition.kind === 'integer' && !Number.isInteger(number))
      )
        throw new AgentError(400, `Out of range: ${name}`);
      values[name] = String(number);
      continue;
    }
    if (name === 'bind' && value && !isIP(value))
      throw new AgentError(400, 'Invalid bind address');
    if (name === 'always-use-relay' && !['Y', 'N'].includes(value))
      throw new AgentError(400, 'Expected Y or N');
    values[name] = value;
  }
  return { values };
}

export function validateBans(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some((key) => !['device_ids', 'ips'].includes(key)) ||
    !Array.isArray(input.device_ids) ||
    !Array.isArray(input.ips) ||
    input.device_ids.length > 10000 ||
    input.ips.length > 10000 ||
    input.device_ids.some(
      (id) => typeof id !== 'string' || !id || id.length > 100 || /\s/.test(id),
    ) ||
    input.ips.some((ip) => typeof ip !== 'string' || !isIP(ip))
  )
    throw new AgentError(400, 'Invalid ban rules');
  return {
    device_ids: [...new Set(input.device_ids)].sort(),
    ips: [
      ...new Set(
        input.ips.map((ip) =>
          ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4
            ? ip.slice(7)
            : ip,
        ),
      ),
    ].sort(),
  };
}

function redacted(config, service) {
  return {
    ...config,
    values: Object.fromEntries(
      Object.entries(config.values).map(([name, value]) => [
        name,
        schema[service].find((item) => item.name === name)?.secret
          ? REDACTED
          : value,
      ]),
    ),
  };
}

export function createAgent({
  token,
  serverToken,
  directory = '/data/management',
  nodeId = 'local',
  docker = new DockerDriver({ nodeId }),
  urls = { hbbs: 'http://hbbs:21120', hbbr: 'http://hbbr:21121' },
  fetcher = fetch,
  readinessAttempts = 10,
} = {}) {
  if (
    typeof token !== 'string' ||
    token.length < 32 ||
    typeof serverToken !== 'string' ||
    serverToken.length < 32
  )
    throw new Error(
      'Both management tokens must contain at least 32 characters',
    );
  let queue = Promise.resolve();
  const locked = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const file = (name) => path.join(directory, `${name}.json`);
  const read = async (name, fallback) => {
    try {
      return JSON.parse(await fs.readFile(file(name), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw new AgentError(500, 'Invalid persisted management data');
    }
  };
  const save = async (name, value) => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file(name)}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value), {
        mode: 0o600,
        flag: 'wx',
      });
      await fs.rename(temporary, file(name));
    } finally {
      await fs.rm(temporary, { force: true });
    }
  };
  const serverRequest = async (service, route, method = 'GET', body) => {
    let response;
    try {
      response = await fetcher(`${urls[service]}${route}`, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${serverToken}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(4000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new AgentError(503, `${service} management API unavailable`);
    }
    if (!response.ok)
      throw new AgentError(
        response.status === 404 ? 404 : 502,
        `${service} management API rejected the request`,
      );
    const reader = response.body?.getReader();
    if (!reader)
      throw new AgentError(
        502,
        `${service} returned an empty management response`,
      );
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Response too large');
        }
        chunks.push(Buffer.from(value));
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new Error('Invalid response');
      return result;
    } catch {
      throw new AgentError(
        502,
        `${service} returned an invalid management response`,
      );
    } finally {
      reader.releaseLock();
    }
  };
  const syncPolicy = async () => {
    const bans = validateBans(await read('bans', { device_ids: [], ips: [] }));
    const results = await Promise.all(
      services.map(async (service) => {
        try {
          await serverRequest(service, '/v1/bans', 'PUT', bans);
          return [service, { state: 'applied' }];
        } catch {
          return [service, { state: 'pending' }];
        }
      }),
    );
    return { ...bans, synchronization: Object.fromEntries(results) };
  };
  const ready = async (service, expectedPort) => {
    for (let attempt = 0; attempt < readinessAttempts; attempt++) {
      try {
        const status = await serverRequest(service, '/v1/status');
        if (
          status.service !== service ||
          status.api_version !== 1 ||
          !Number.isFinite(status.uptime_seconds) ||
          status.uptime_seconds < 1
        )
          throw new AgentError(502, 'Incompatible server management API');
        const effective = await serverRequest(service, '/v1/config');
        if (Number(effective.values?.port) !== expectedPort)
          throw new AgentError(
            502,
            'Server listener port does not match container bindings',
          );
        await serverRequest(
          service,
          '/v1/bans',
          'PUT',
          validateBans(await read('bans', { device_ids: [], ips: [] })),
        );
        return;
      } catch {
        if (attempt + 1 < readinessAttempts) await delay(1000);
      }
    }
    throw new AgentError(503, `${service} failed its management health check`);
  };
  const apply = async (service) => {
    const desired = validateConfig(
      service,
      await read(`${service}-config`, { values: {} }),
    );
    const previous = await read(`${service}-applied`, { values: {} });
    const container = await docker.inspect(service);
    const port = Number(
      desired.values.port ||
        container.Config.Labels['io.rustdesk.console.deployment-port'] ||
        (service === 'hbbs' ? 21116 : 21117),
    );
    try {
      await docker.apply(
        service,
        port,
        (expectedPort) => ready(service, expectedPort),
        async () => {
          await save(`${service}-config`, previous);
          await save(`${service}-applied`, previous);
        },
        () => save(`${service}-applied`, desired),
      );
    } catch (error) {
      // Failed application restores the last applied override, including secrets.
      try {
        await save(`${service}-config`, previous);
      } catch {
        console.error(`Unable to restore saved configuration: ${service}`);
      }
      throw error;
    }
    return { state: 'applied' };
  };
  const config = async (service) => {
    const desired = await read(`${service}-config`, { values: {} });
    let effective;
    try {
      effective = await serverRequest(service, '/v1/config');
    } catch {
      effective = null;
    }
    const applied = await read(`${service}-applied`, null);
    return {
      schema: schema[service],
      ...redacted(
        { values: { ...(effective?.values || {}), ...desired.values } },
        service,
      ),
      effective_values: effective
        ? redacted({ values: effective.values || {} }, service).values
        : null,
      pending_restart:
        applied === null
          ? Object.keys(desired.values).length > 0
          : JSON.stringify(desired) !== JSON.stringify(applied),
      available: effective !== null,
    };
  };
  const dispatch = async (method, pathname, input, query) => {
    if (method === 'GET' && pathname === '/v1/status') {
      const status = await Promise.all(
        services.map(async (service) => {
          try {
            const info = await docker.inspect(service);
            let runtime;
            try {
              runtime = await serverRequest(service, '/v1/status');
            } catch {
              runtime = null;
            }
            return {
              service,
              state: info.State.Status,
              running: info.State.Running,
              image: info.Config.Image,
              started_at: info.State.StartedAt,
              restart_count: info.RestartCount,
              runtime,
              available:
                runtime?.api_version === 1 && runtime.service === service,
            };
          } catch (error) {
            return {
              service,
              state: 'unavailable',
              available: false,
              error: error.message,
            };
          }
        }),
      );
      return { api_version: 1, node_id: nodeId, services: status };
    }
    if (pathname === '/v1/bans') {
      if (method === 'GET') return locked(syncPolicy);
      if (method === 'PUT')
        return locked(async () => {
          await save('bans', validateBans(input));
          return syncPolicy();
        });
    }
    if (method === 'GET' && pathname === '/v1/peers')
      return serverRequest('hbbs', '/v1/peers');
    if (method === 'GET' && pathname === '/v1/sessions')
      return serverRequest('hbbr', '/v1/sessions');
    const session = /^\/v1\/sessions\/([^/]+)$/.exec(pathname);
    if (session && method === 'DELETE')
      return locked(() =>
        serverRequest(
          'hbbr',
          `/v1/sessions/${encodeURIComponent(decodeURIComponent(session[1]))}`,
          'DELETE',
        ),
      );
    const match =
      /^\/v1\/services\/(hbbs|hbbr)\/(logs|config|start|stop|restart|apply)$/.exec(
        pathname,
      );
    if (match) {
      const [, service, action] = match;
      if (action === 'logs' && method === 'GET') {
        const tail = Number(query.get('tail') || 200);
        if (!Number.isInteger(tail) || tail < 1 || tail > 2000)
          throw new AgentError(400, 'Invalid log limit');
        const text = await docker.logs(service, tail);
        const sanitized = text
          .replaceAll(serverToken, '[redacted]')
          .replace(
            /(token|secret|(?:private[_ -]?)?key|password)\s*[:=]\s*\S+/gi,
            '$1=[redacted]',
          );
        return { text: sanitized };
      }
      if (action === 'config' && method === 'GET')
        return locked(() => config(service));
      if (action === 'config' && method === 'PUT')
        return locked(async () => {
          const old = await read(`${service}-config`, { values: {} });
          const next = validateConfig(service, input, old.values);
          if ((await read(`${service}-applied`, null)) === null)
            await save(`${service}-applied`, old);
          await save(`${service}-config`, next);
          return config(service);
        });
      if (
        method === 'POST' &&
        ['start', 'stop', 'restart', 'apply'].includes(action)
      )
        return locked(async () => {
          if (action === 'stop') {
            await docker.action(service, action);
            return { state: 'stopped' };
          }
          return apply(service);
        });
    }
    throw new AgentError(404, 'Unknown management endpoint');
  };
  const handler = async (req, res) => {
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(req.headers.authorization || '');
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.writeHead(401);
      res.end('{"error":"Unauthorized"}');
      return;
    }
    try {
      const url = new URL(req.url, 'http://agent');
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 128 * 1024) {
          req.resume();
          throw new AgentError(413, 'Request too large');
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      let input;
      try {
        input = body ? JSON.parse(body) : undefined;
      } catch {
        throw new AgentError(400, 'Invalid JSON');
      }
      const result = await dispatch(
        req.method,
        url.pathname,
        input,
        url.searchParams,
      );
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error instanceof AgentError ? error.status : 500);
      res.end(
        JSON.stringify({
          error:
            error instanceof AgentError
              ? error.message
              : 'Management operation failed',
        }),
      );
    }
  };
  return {
    handler,
    syncPolicy: () => locked(syncPolicy),
    server: () => http.createServer(handler),
  };
}
