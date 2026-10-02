// CI-only end-to-end checks against the integrated Docker deployment.
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const origin = process.env.CONSOLE_URL || 'http://127.0.0.1:21114';
let token;
async function api(route, method = 'GET', body) {
  const response = await fetch(`${origin}/api${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(240000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${route}: HTTP ${response.status}`);
  return response.json();
}
async function eventually(check, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await check();
      if (result) return result;
    } catch {
      /* Retry startup/transient failures in CI. */
    }
    await delay(1000);
  }
  throw new Error('Timed out waiting for integrated stack');
}
await eventually(async () => (await fetch(`${origin}/api/login-options`)).ok);
const anonymous = await fetch(`${origin}/api/servers`);
assert.equal(anonymous.status, 401);
const login = await api('/login', 'POST', {
  username: 'databk',
  password: 'databk',
  deviceInfo: { type: 'browser', name: 'CI integration' },
});
token = login.access_token;
assert.ok(token, 'Default CI administrator login must return an access token');
await eventually(async () => {
  const nodes = await api('/servers');
  return (
    nodes.data[0]?.reachable &&
    nodes.data[0].services.every((service) => service.available)
  );
});
const root = '/servers/local';
const registrations = await api(`${root}/peers`);
assert.ok(Array.isArray(registrations.data));
assert.ok(Array.isArray((await api(`${root}/sessions`)).data));
const logs = await api(`${root}/services/hbbs/logs`);
assert.equal(typeof logs.text, 'string');

const configuration = await api(`${root}/services/hbbs/config`);
assert.equal(configuration.values.key, '__REDACTED__');
await api(`${root}/services/hbbs/config`, 'PUT', {
  values: { ...configuration.values, 'relay-servers': 'localhost:21117' },
});
assert.equal((await api(`${root}/services/hbbs/config`)).pending_restart, true);
await api(`${root}/services/hbbs/apply`, 'POST');
assert.equal(
  (await api(`${root}/services/hbbs/config`)).pending_restart,
  false,
);

// Minimal protobuf encoder for RequestRelay and RustDesk's length frame.
const varint = (value) => {
  const bytes = [];
  do {
    const byte = value & 127;
    value >>>= 7;
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
};
const stringField = (field, text) => {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes]);
};
// Register a real native peer over hbbs UDP without inventing Console device records.
const nativeId = '900001';
const nativeUuid = randomBytes(16);
const registration = Buffer.concat([
  stringField(1, nativeId),
  stringField(2, nativeUuid),
  stringField(3, randomBytes(32)),
]);
const registerMessage = Buffer.concat([
  varint((15 << 3) | 2),
  varint(registration.length),
  registration,
]);
const udp = dgram.createSocket('udp4');
try {
  await new Promise((resolve, reject) =>
    udp.send(registerMessage, 21116, '127.0.0.1', (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  await eventually(async () => {
    const peer = (await api(`${root}/peers`)).data.find(
      (peer) => peer.id === nativeId,
    );
    return peer?.online && peer.uuid === nativeUuid.toString('base64');
  }, 20);
} finally {
  udp.close();
}

function relayFrame(uuid) {
  const request = Buffer.concat([
    stringField(1, '123456'),
    stringField(2, uuid),
  ]);
  const message = Buffer.concat([
    varint((18 << 3) | 2),
    varint(request.length),
    request,
  ]);
  const header = Buffer.alloc(message.length <= 63 ? 1 : 2);
  if (header.length === 1) header[0] = message.length << 2;
  else header.writeUInt16LE((message.length << 2) | 1);
  return Buffer.concat([header, message]);
}
async function pair(uuid) {
  const connect = async () => {
    const socket = net.connect(21117, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write(relayFrame(uuid));
    return socket;
  };
  const sockets = [];
  try {
    sockets.push(await connect());
    sockets.push(await connect());
    await eventually(
      async () =>
        (await api(`${root}/sessions`)).data.some(
          (session) => session.uuid === uuid,
        ),
      20,
    );
    const payload = Buffer.from('RustDesk managed relay integration');
    const received = new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      const timer = setTimeout(
        () => reject(new Error('Relay data transfer timed out')),
        10000,
      );
      sockets[1].on('data', (chunk) => {
        chunks.push(chunk);
        bytes += chunk.length;
        if (bytes >= payload.length) {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks));
        }
      });
    });
    sockets[0].write(payload);
    assert.deepEqual(await received, payload);
    return sockets;
  } catch (error) {
    sockets.forEach((socket) => socket.destroy());
    throw error;
  }
}
let sockets = [];
try {
  const uuid = randomUUID();
  sockets = await pair(uuid);
  const response = await api(`${root}/sessions/${uuid}`, 'DELETE');
  assert.equal(response.state, 'closing');
  await eventually(
    async () =>
      !(await api(`${root}/sessions`)).data.some(
        (session) => session.uuid === uuid,
      ),
    20,
  );
  sockets.forEach((socket) => socket.destroy());

  const bannedUuid = randomUUID();
  sockets = await pair(bannedUuid);
  const policy = await api(`${root}/bans`, 'PUT', {
    device_ids: ['123456', nativeId],
    ips: [],
  });
  assert.ok(
    Object.values(policy.synchronization).every(
      (state) => state.state === 'applied',
    ),
  );
  await eventually(
    async () =>
      !(await api(`${root}/sessions`)).data.some(
        (session) => session.uuid === bannedUuid,
      ),
    20,
  );
  await eventually(async () => {
    const peer = (await api(`${root}/peers`)).data.find(
      (peer) => peer.id === nativeId,
    );
    return peer?.banned && !peer.online;
  }, 20);
  sockets.forEach((socket) => socket.destroy());
  await api(`${root}/services/hbbr/restart`, 'POST');
  assert.deepEqual((await api(`${root}/bans`)).device_ids, [
    '123456',
    nativeId,
  ]);
  await api(`${root}/bans`, 'PUT', { device_ids: [], ips: [] });

  await api(`${root}/services/hbbr/stop`, 'POST');
  await eventually(
    async () =>
      !(await api('/servers')).data[0].services.find(
        (service) => service.service === 'hbbr',
      ).running,
    20,
  );
  await api(`${root}/services/hbbr/start`, 'POST');

  // Listener changes must retain the public host port and survive recreation.
  const relayConfig = await api(`${root}/services/hbbr/config`);
  await api(`${root}/services/hbbr/config`, 'PUT', {
    values: { ...relayConfig.values, port: '22117' },
  });
  await api(`${root}/services/hbbr/apply`, 'POST');
  assert.equal(
    (await api(`${root}/services/hbbr/config`)).effective_values.port,
    '22117',
  );
  const movedUuid = randomUUID();
  sockets = await pair(movedUuid);
  await api(`${root}/sessions/${movedUuid}`, 'DELETE');
} finally {
  sockets.forEach((socket) => socket.destroy());
}
console.log('Integrated server management checks passed');
