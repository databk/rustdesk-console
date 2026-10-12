import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { WebClientAuthorizationService } from './web-client-authorization.service';
import {
  WebClientGateway,
  WEB_CLIENT_GATEWAY_LIMITS,
} from './web-client.gateway';
import { WebClientSessionService } from './web-client-session.service';
import { ServerManagementService } from '../server-management/server-management.service';
import { unavailable } from '../../../network/tcp-observation.js';
import type { WebClientGrant } from './web-client-session.service';
import { WebClientService } from './web-client.service';

// 数据库审计适配器在此注入替身；不加载其 uuid ESM 依赖。网关、会话生命周期和 WS 均是真实实现。
jest.mock('uuid', () => ({ v4: jest.fn() }));

const ORIGIN = 'https://console.example.test';
const KEY = Buffer.alloc(32, 4).toString('base64');
const TARGET = '123456789';
const ACTOR = { id: 'operator', jti: 'private-login-id', isAdmin: false };

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    bytes.push((value & 127) | (value >= 128 ? 128 : 0));
    value = Math.floor(value / 128);
  } while (value);
  return Buffer.from(bytes);
}
function text(field: number, value: string | Buffer): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}
function integer(field: number, value: number): Buffer {
  return Buffer.concat([varint(field * 8), varint(value)]);
}
function punch(target = TARGET, kind = 0): Buffer {
  return text(
    8,
    Buffer.concat([
      text(1, target),
      integer(2, 2),
      text(3, KEY),
      integer(4, kind),
      integer(8, 1),
      text(6, '1.4.9'),
    ]),
  );
}
function requestRelay(uuid: string, target = TARGET, kind = 0): Buffer {
  return text(
    18,
    Buffer.concat([
      text(1, target),
      text(2, uuid),
      text(6, KEY),
      integer(7, kind),
    ]),
  );
}
function received(
  socket: WebSocket,
): Promise<{ bytes: Buffer; binary: boolean }> {
  return new Promise((resolve, reject) => {
    const onClose = () => {
      cleanup();
      reject(new Error('Socket closed before reply'));
    };
    const onMessage = (data: RawData, binary: boolean) => {
      cleanup();
      resolve({
        bytes: Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer),
        binary,
      });
    };
    const cleanup = () => {
      socket.removeListener('close', onClose);
      socket.removeListener('message', onMessage);
    };
    socket.once('close', onClose);
    socket.once('message', onMessage);
  });
}
function closed(socket: WebSocket): Promise<number> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve(1000);
  return new Promise((resolve) =>
    socket.once('close', (code) => resolve(code)),
  );
}
async function listening(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}
function url(server: Server): string {
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('Web client gateway real WebSocket integration', () => {
  let http: Server;
  let idHttp: Server;
  let relayHttp: Server;
  let idServer: WebSocketServer;
  let relayServer: WebSocketServer;
  let gateway: WebClientGateway;
  let sessions: WebClientSessionService;
  let allowed: boolean;
  let idReply: Buffer;
  let uuid: string;
  let idMessages: Buffer[];
  let relayMessages: Buffer[];
  let idConnections: number;
  let relayConnections: number;
  let clients: WebSocket[];
  let validate: jest.Mock;
  let record: jest.Mock;

  beforeEach(async () => {
    allowed = true;
    uuid = randomUUID();
    idReply = text(
      19,
      Buffer.concat([
        text(2, uuid),
        text(3, 'untrusted-advertisement.invalid:21117'),
        text(5, Buffer.alloc(100)),
        text(7, '1.5.0'),
      ]),
    );
    idMessages = [];
    relayMessages = [];
    idConnections = 0;
    relayConnections = 0;
    clients = [];
    http = createServer();
    idHttp = createServer();
    relayHttp = createServer();
    idServer = new WebSocketServer({ server: idHttp });
    relayServer = new WebSocketServer({ server: relayHttp });
    idServer.on('connection', (socket) => {
      idConnections++;
      socket.on('message', (bytes) => {
        idMessages.push(Buffer.from(bytes as Buffer));
        socket.send(idReply, { binary: true });
      });
    });
    relayServer.on('connection', (socket) => {
      relayConnections++;
      let first = true;
      socket.on('message', (bytes) => {
        relayMessages.push(Buffer.from(bytes as Buffer));
        // 首响应和后续数据均当作不透明原生握手/密文，网关不得改变字节。
        socket.send(first ? Buffer.from([0xde, 0xad, 0x00, 0xff]) : bytes, {
          binary: true,
        });
        first = false;
      });
    });
    await listening(idHttp);
    await listening(relayHttp);
    const configuration = new WebClientService(
      new ConfigService({
        WEB_CLIENT_ENABLED: 'true',
        WEB_CLIENT_ALLOWED_ORIGIN: ORIGIN,
        WEB_CLIENT_SERVER_PUBLIC_KEY: KEY,
        WEB_CLIENT_ID_SERVER_URL: 'wss://public.example.test/ws/id',
        WEB_CLIENT_RELAY_SERVER_URL: 'wss://public.example.test/ws/relay',
        WEB_CLIENT_ID_UPSTREAM_URL: url(idHttp),
        WEB_CLIENT_RELAY_UPSTREAM_URL: url(relayHttp),
      }),
    );
    validate = jest.fn(() => {
      if (!allowed)
        return Promise.reject(new ForbiddenException('Authorization revoked'));
      return Promise.resolve({
        peer: { uuid: 'registered-peer', id: TARGET },
        expiresAt: Date.now() + 3600_000,
      });
    });
    record = jest.fn().mockResolvedValue(undefined);
    sessions = new WebClientSessionService(
      { validate } as unknown as WebClientAuthorizationService,
      configuration,
      { record } as unknown as RbacAuditService,
    );
    sessions.onModuleInit();
    gateway = new WebClientGateway(
      {
        httpAdapter: { getHttpServer: () => http },
      } as unknown as HttpAdapterHost,
      configuration,
      sessions,
      {
        relayConnection: jest
          .fn()
          .mockResolvedValue(
            unavailable('connection', 'namespace_unobservable'),
          ),
      } as unknown as ServerManagementService,
    );
    gateway.onModuleInit();
    await listening(http);
  });

  afterEach(async () => {
    gateway.onModuleDestroy();
    await sessions.onModuleDestroy();
    for (const socket of [
      ...clients,
      ...idServer.clients,
      ...relayServer.clients,
    ]) {
      socket.on('error', () => {});
      socket.terminate();
    }
    await new Promise<void>((resolve) => idServer.close(() => resolve()));
    await new Promise<void>((resolve) => relayServer.close(() => resolve()));
    for (const server of [http, idHttp, relayHttp])
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connect(
    path = '/api/web-client/socket',
    origin: string | null = ORIGIN,
  ): Promise<WebSocket> {
    const socket = new WebSocket(
      `${url(http)}${path}`,
      origin === null ? {} : { origin },
    );
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return socket;
  }
  async function authenticate(ticket: string): Promise<WebSocket> {
    const socket = await connect();
    const reply = received(socket);
    socket.send(JSON.stringify({ ticket }));
    expect(await reply).toEqual({
      bytes: Buffer.from('{"ready":true}'),
      binary: false,
    });
    return socket;
  }
  async function rendezvous(
    grant: WebClientGrant,
    bytes = punch(),
  ): Promise<void> {
    const socket = await authenticate(grant.tickets.rendezvous);
    const reply = received(socket);
    socket.send(bytes);
    expect(await reply).toEqual({ bytes: idReply, binary: true });
    const end = closed(socket);
    socket.close();
    await end;
  }
  async function relay(grant: WebClientGrant): Promise<WebSocket> {
    await rendezvous(grant);
    const socket = await authenticate(grant.tickets.relay);
    const reply = received(socket);
    socket.send(requestRelay(uuid));
    expect(await reply).toEqual({
      bytes: Buffer.from([0xde, 0xad, 0x00, 0xff]),
      binary: true,
    });
    return socket;
  }

  it('observes only the bound desktop relay sending direction; an internal proxy hop is never the entry algorithm', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    await relay(grant);
    const server = (gateway as unknown as { servers: ServerManagementService })
      .servers;
    const result = await gateway.observeNetwork(grant.sessionGuid);
    expect(result.entry.algorithm).toBeNull();
    expect(result.entry.reason).toBe('proxy_unobservable');
    const tuple = jest.mocked(server.relayConnection).mock.calls[0][0];
    expect(tuple.local.port).toBe(
      (relayHttp.address() as { port: number }).port,
    );
    expect(tuple.remote.port).not.toBe(tuple.local.port);
    expect((await gateway.observeNetwork('another-session')).relay.reason).toBe(
      'not_connected',
    );
    expect(server.relayConnection).toHaveBeenCalledTimes(1);
  });
  it('forwards real opaque binary both ways through fixed upstream, with normal rendezvous handoff', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await relay(grant);
    const ciphertext = Buffer.from([0xff, 0x00, 0x80, 0x19, 0x07, 0x41, 0xe7]);
    const reply = received(socket);
    socket.send(ciphertext);
    expect(await reply).toEqual({ bytes: ciphertext, binary: true });
    expect(idConnections).toBe(1);
    expect(relayConnections).toBe(1);
    expect(idMessages).toEqual([punch()]);
    expect(relayMessages).toEqual([requestRelay(uuid), ciphertext]);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'web_client.gateway_open',
        requestId: grant.sessionGuid,
      }),
    );
    const end = closed(socket);
    await sessions.closeGrant(grant.sessionGuid, 'cancelled');
    expect(await end).toBe(1000);
  });

  it.each([
    ['different Origin', '/api/web-client/socket', 'https://attacker.invalid'],
    ['missing Origin', '/api/web-client/socket', null],
    ['query secret', '/api/web-client/socket?ticket=secret', ORIGIN],
  ])(
    'rejects %s before upgrade or upstream use',
    async (_label, path, origin) => {
      await expect(connect(path, origin)).rejects.toThrow('403');
      expect(idConnections + relayConnections).toBe(0);
    },
  );

  it('does not intercept unrelated upgrade routes', async () => {
    let handled = false;
    const other = new WebSocketServer({ noServer: true });
    http.on('upgrade', (request, socket, head) => {
      if (request.url === '/other')
        other.handleUpgrade(request, socket, head, (connection) => {
          handled = true;
          connection.close();
        });
    });
    const socket = await connect('/other');
    await closed(socket);
    expect(handled).toBe(true);
    other.close();
  });

  it.each([
    [
      'duplicate ticket',
      (ticket: string) => `{"ticket":"${ticket}","ticket":"${ticket}"}`,
    ],
    [
      'extra property',
      (ticket: string) => JSON.stringify({ ticket, targetId: 'other' }),
    ],
    [
      'oversized authentication',
      (ticket: string) => `${JSON.stringify({ ticket })}${' '.repeat(4096)}`,
    ],
    ['invalid ticket', () => JSON.stringify({ ticket: 'unknown' })],
  ])('rejects %s in the first frame', async (_label, body) => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await connect();
    const end = closed(socket);
    socket.send(body(grant.tickets.rendezvous));
    await end;
    expect(idConnections + relayConnections).toBe(0);
  });

  it('rejects replayed or expired ticket and premature relay ticket', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const first = await authenticate(grant.tickets.rendezvous);
    const replay = await connect();
    let end = closed(replay);
    replay.send(JSON.stringify({ ticket: grant.tickets.rendezvous }));
    await end;
    const premature = await connect();
    end = closed(premature);
    premature.send(JSON.stringify({ ticket: grant.tickets.relay }));
    await end;
    const expired = await sessions.create(ACTOR, TARGET);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    try {
      const socket = await connect();
      end = closed(socket);
      socket.send(JSON.stringify({ ticket: expired.tickets.rendezvous }));
      await end;
    } finally {
      clock.mockRestore();
    }
    first.close();
    expect(idConnections + relayConnections).toBe(0);
  });

  it('rejects binary input before ticket authentication and text after it', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const before = await connect();
    let end = closed(before);
    before.send(punch());
    expect(await end).toBe(1008);
    const after = await authenticate(grant.tickets.rendezvous);
    end = closed(after);
    after.send('{"another":"request"}');
    expect(await end).toBe(1008);
    expect(idConnections + relayConnections).toBe(0);
  });

  it.each([
    ['different target', punch('987654321')],
    ['file purpose mismatch', punch(TARGET, 1)],
    ['PORT_FORWARD mismatch', punch(TARGET, 2)],
    [
      'different message oneof',
      requestRelay('12345678-1234-1234-1234-123456789012'),
    ],
    ['duplicate oneof', Buffer.concat([punch(), punch()])],
  ])('rejects rendezvous %s before contacting hbbs', async (_label, bytes) => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await authenticate(grant.tickets.rendezvous);
    const end = closed(socket);
    socket.send(bytes);
    await end;
    expect(idConnections).toBe(0);
  });

  it('rejects a second ID query and closes all channels for that grant', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await authenticate(grant.tickets.rendezvous);
    const reply = received(socket);
    socket.send(punch());
    await reply;
    const end = closed(socket);
    socket.send(punch('987654321'));
    await end;
    expect(idMessages).toEqual([punch()]);
    await expect(sessions.consumeTicket(grant.tickets.relay)).rejects.toThrow();
  });

  it.each(['uuid', 'target', 'kind'])(
    'rejects mismatched relay %s before contacting hbbr',
    async (changed) => {
      const grant = await sessions.create(ACTOR, TARGET);
      await rendezvous(grant);
      const socket = await authenticate(grant.tickets.relay);
      const end = closed(socket);
      socket.send(
        requestRelay(
          changed === 'uuid' ? randomUUID() : uuid,
          changed === 'target' ? '987654321' : TARGET,
          changed === 'kind' ? 1 : 0,
        ),
      );
      expect(await end).toBe(1008);
      expect(relayConnections).toBe(0);
    },
  );

  it.each([
    ['offline', text(11, integer(3, 2))],
    ['identity refused', text(11, integer(3, 3))],
    ['permission refused', text(19, text(6, 'denied'))],
  ])(
    'delivers official %s reply before graceful channel close and ends the grant',
    async (_label, replyBytes) => {
      idReply = replyBytes;
      const grant = await sessions.create(ACTOR, TARGET);
      const socket = await authenticate(grant.tickets.rendezvous);
      const reply = received(socket);
      const end = closed(socket);
      socket.send(punch());
      expect(await reply).toEqual({ bytes: replyBytes, binary: true });
      await end;
      await expect(
        sessions.consumeTicket(grant.tickets.relay),
      ).rejects.toThrow();
      expect(relayConnections).toBe(0);
    },
  );

  it('closes an active relay on service-side role revocation', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await relay(grant);
    const end = closed(socket);
    allowed = false;
    await sessions.revalidateSessions();
    expect(await end).toBe(4403);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'web_client.session_ended',
        afterState: expect.objectContaining({
          reason: 'authorization_revoked',
          source: 'server',
        }),
      }),
    );
    expect(relayMessages).toHaveLength(1);
  });

  it('does not revive a grant cancelled while ticket authorization is awaiting the database', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    let release: (() => void) | undefined;
    validate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              peer: { uuid: 'registered-peer', id: TARGET },
              expiresAt: Date.now() + 3600_000,
            });
        }),
    );
    const socket = await connect();
    const end = closed(socket);
    socket.send(JSON.stringify({ ticket: grant.tickets.rendezvous }));
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await sessions.closeGrant(grant.sessionGuid, 'cancelled');
    release();
    await end;
    expect(idConnections + relayConnections).toBe(0);
  });

  it('closes desktop and actual file channels together when the parent is ended', async () => {
    const desktop = await sessions.create(ACTOR, TARGET);
    const desktopSocket = await relay(desktop);
    uuid = randomUUID();
    idReply = text(
      19,
      Buffer.concat([
        text(2, uuid),
        text(5, Buffer.alloc(100)),
        text(7, '1.5.0'),
      ]),
    );
    const file = await sessions.createFile(ACTOR, desktop.sessionGuid);
    await rendezvous(file, punch(TARGET, 1));
    const fileSocket = await authenticate(file.tickets.relay);
    const response = received(fileSocket);
    fileSocket.send(requestRelay(uuid, TARGET, 1));
    expect(await response).toEqual({
      bytes: Buffer.from([0xde, 0xad, 0x00, 0xff]),
      binary: true,
    });
    const desktopEnd = closed(desktopSocket);
    const fileEnd = closed(fileSocket);
    await sessions.closeGrant(desktop.sessionGuid, 'cancelled');
    expect(await desktopEnd).toBe(1000);
    expect(await fileEnd).toBe(1000);
    expect(relayConnections).toBe(2);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetGuid: file.sessionGuid,
        afterState: expect.objectContaining({
          parentGuid: desktop.sessionGuid,
          reason: 'parent_closed',
        }),
      }),
    );
  });

  it('closes the actual relay with 4401 when its login is revoked', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await relay(grant);
    const end = closed(socket);
    validate.mockRejectedValueOnce(new UnauthorizedException('Token revoked'));
    await sessions.revalidateSessions();
    expect(await end).toBe(4401);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          reason: 'authentication_revoked',
        }),
      }),
    );
  });

  it('does not revive a relay cancelled while its opening audit is pending', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    await rendezvous(grant);
    let release: (() => void) | undefined;
    record.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const socket = await authenticate(grant.tickets.relay);
    const end = closed(socket);
    socket.send(requestRelay(uuid));
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await sessions.closeGrant(grant.sessionGuid, 'cancelled');
    release();
    await end;
    expect(relayMessages).toHaveLength(0);
  });

  it('rejects a UUID reused by a different grant without closing the first relay', async () => {
    const first = await sessions.create(ACTOR, TARGET);
    const firstSocket = await relay(first);
    const second = await sessions.create(ACTOR, TARGET);
    const socket = await authenticate(second.tickets.rendezvous);
    const end = closed(socket);
    socket.send(punch());
    expect(await end).toBe(1008);
    expect(firstSocket.readyState).toBe(WebSocket.OPEN);
    expect(relayConnections).toBe(1);
  });

  it('ends the grant on an actual upstream relay close', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await relay(grant);
    const end = closed(socket);
    [...relayServer.clients][0].close();
    expect(await end).toBe(1000);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetGuid: grant.sessionGuid,
        afterState: expect.objectContaining({ reason: 'upstream_closed' }),
      }),
    );
  });

  it('rejects a real frame above the 8 MiB message ceiling', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await relay(grant);
    const end = closed(socket);
    socket.send(Buffer.alloc(WEB_CLIENT_GATEWAY_LIMITS.messageBytes + 1));
    expect(await end).toBe(1009);
    expect(relayMessages).toHaveLength(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({ reason: 'overloaded' }),
      }),
    );
  });

  it('does not forward the relay handshake when the server audit cannot be stored', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    await rendezvous(grant);
    record.mockImplementation((entry: { action: string }) => {
      if (entry.action === 'web_client.gateway_open')
        return Promise.reject(new Error('audit unavailable'));
      return Promise.resolve(undefined);
    });
    const socket = await authenticate(grant.tickets.relay);
    const end = closed(socket);
    socket.send(requestRelay(uuid));
    await end;
    expect(relayMessages).toHaveLength(0);
  });

  it('bounds backpressure without queuing or forwarding the rejected frame', async () => {
    const grant = await sessions.create(ACTOR, TARGET);
    const socket = await relay(grant);
    const channels = (
      gateway as unknown as {
        channels: Set<{ upstream?: WebSocket; claim?: { phase: string } }>;
      }
    ).channels;
    const upstream = [...channels].find(
      (channel) => channel.claim?.phase === 'relay',
    )!.upstream!;
    Object.defineProperty(upstream, 'bufferedAmount', {
      get: () => WEB_CLIENT_GATEWAY_LIMITS.bufferedBytes,
    });
    const end = closed(socket);
    socket.send(Buffer.from([1]));
    await end;
    expect(relayMessages).toHaveLength(1);
  });

  it('caps sockets before authentication and times out an unauthed socket', async () => {
    for (let i = 0; i < WEB_CLIENT_GATEWAY_LIMITS.unauthenticatedSockets; i++)
      await connect();
    await expect(connect()).rejects.toThrow('403');
    await closed(clients[0]);
    expect(idConnections + relayConnections).toBe(0);
  }, 8000);
});
