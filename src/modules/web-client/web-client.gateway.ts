import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import {
  createObserver,
  reverseTuple,
  socketTuple,
  unavailable,
} from '../../../network/tcp-observation.js';
import { ServerManagementService } from '../server-management/server-management.service';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import {
  readRendezvousReply,
  validatePunchHoleRequest,
  validateRequestRelay,
} from './web-client-protocol';
import { WebClientSessionService } from './web-client-session.service';
import type { GatewayClaim } from './web-client-session.service';
import { WebClientService } from './web-client.service';

export const WEB_CLIENT_GATEWAY_LIMITS = {
  messageBytes: 8 * 1024 * 1024,
  bufferedBytes: 16 * 1024 * 1024,
  authenticationBytes: 4096,
  authenticationMs: 5000,
  handshakeMs: 12000,
  unauthenticatedSockets: 16,
  sockets: 512,
};

type Stage =
  'ticket' | 'authorizing' | 'request' | 'opening' | 'reply' | 'opaque';
interface Channel {
  browser: WebSocket;
  browserSocket?: Socket;
  entryDirect: boolean;
  upstreamSocket?: Socket;
  upstream?: WebSocket;
  claim?: GatewayClaim;
  stage: Stage;
  stopped: boolean;
  replied: boolean;
  refused: boolean;
  timer?: ReturnType<typeof setTimeout>;
  detach?: () => void;
}

function asBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function messageTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
  );
}

@Injectable()
export class WebClientGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebClientGateway.name);
  private readonly channels = new Set<Channel>();
  private readonly unauthenticated = new Set<Channel>();
  private server?: Server;
  private socketServer?: WebSocketServer;
  private destroyed = false;
  private readonly observer = createObserver();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly configuration: WebClientService,
    private readonly sessions: WebClientSessionService,
    private readonly servers: ServerManagementService,
  ) {}

  async observeNetwork(sessionGuid: string) {
    const channel = [...this.channels].find(
      (item) =>
        !item.stopped &&
        item.stage === 'opaque' &&
        item.claim?.sessionGuid === sessionGuid &&
        item.claim.kind === 'desktop' &&
        item.claim.phase === 'relay',
    );
    const empty = () => ({
      api_version: 1 as const,
      session_guid: sessionGuid,
      entry: unavailable('connection', 'not_connected'),
      relay: unavailable('connection', 'not_connected'),
    });
    if (!channel) return empty();
    const browserSocket = channel.browserSocket;
    const upstreamSocket = channel.upstreamSocket;
    const entryTuple = socketTuple(browserSocket);
    const upstreamTuple = socketTuple(upstreamSocket);
    const [entry, relay] = await Promise.all([
      channel.entryDirect && entryTuple
        ? this.observer.connection(entryTuple)
        : Promise.resolve(unavailable('connection', 'proxy_unobservable')),
      upstreamTuple
        ? this.servers.relayConnection(reverseTuple(upstreamTuple))
        : Promise.resolve(unavailable('connection', 'connection_not_found')),
    ]);
    if (
      !this.channels.has(channel) ||
      channel.stopped ||
      channel.stage !== 'opaque' ||
      browserSocket?.destroyed ||
      upstreamSocket?.destroyed ||
      channel.browserSocket !== browserSocket ||
      channel.upstreamSocket !== upstreamSocket
    )
      return empty();
    return { api_version: 1 as const, session_guid: sessionGuid, entry, relay };
  }

  onModuleInit(): void {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.socketServer = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      perMessageDeflate: false,
      maxPayload: WEB_CLIENT_GATEWAY_LIMITS.messageBytes,
    });
    this.server.on('upgrade', this.upgrade);
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.server?.removeListener('upgrade', this.upgrade);
    for (const channel of this.channels) {
      this.stop(channel, 'application_shutdown', true, true);
      channel.browser.terminate();
      channel.upstream?.terminate();
    }
    this.channels.clear();
    this.unauthenticated.clear();
    this.socketServer?.close();
  }

  private readonly upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    let path: string;
    try {
      path = new URL(request.url ?? '', 'http://gateway.invalid').pathname;
    } catch {
      return;
    }
    if (path !== '/api/web-client/socket') return;
    try {
      if (
        this.destroyed ||
        request.url !== '/api/web-client/socket' ||
        request.headers.origin !== this.configuration.getAllowedOrigin() ||
        this.channels.size >= WEB_CLIENT_GATEWAY_LIMITS.sockets ||
        this.unauthenticated.size >=
          WEB_CLIENT_GATEWAY_LIMITS.unauthenticatedSockets
      )
        throw new Error('Gateway rejected');
      this.socketServer?.handleUpgrade(request, socket, head, (browser) => {
        this.accept(browser, request);
      });
    } catch {
      // 不回显 URL、Origin、token 或配置错误。
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  };

  private accept(browser: WebSocket, request?: IncomingMessage): void {
    const origin = new URL(this.configuration.getAllowedOrigin());
    const channel: Channel = {
      browser,
      browserSocket: request?.socket,
      // A plain/internal socket belongs to a proxy hop, not the final browser sender.
      entryDirect:
        !!request &&
        (request.socket as TLSSocket).encrypted === true &&
        request.socket.localPort === Number(origin.port || 443) &&
        request.headers.host === origin.host &&
        !Object.keys(request.headers).some(
          (name) => name === 'forwarded' || name.startsWith('x-forwarded-'),
        ),
      stage: 'ticket',
      stopped: false,
      replied: false,
      refused: false,
    };
    this.channels.add(channel);
    this.unauthenticated.add(channel);
    this.arm(channel, WEB_CLIENT_GATEWAY_LIMITS.authenticationMs);
    browser.on('message', (data, binary) => {
      this.receive(channel, asBuffer(data), binary);
    });
    browser.on('error', (error: unknown) =>
      this.stop(
        channel,
        messageTooLarge(error) ? 'overloaded' : 'protocol_error',
      ),
    );
    browser.on('close', () => {
      const handoff =
        channel.claim?.phase === 'rendezvous' &&
        channel.replied &&
        !channel.refused;
      this.stop(channel, 'client_closed', false, handoff);
      this.channels.delete(channel);
      this.unauthenticated.delete(channel);
    });
  }

  private receive(channel: Channel, bytes: Buffer, binary: boolean): void {
    if (channel.stopped) return;
    if (bytes.length > WEB_CLIENT_GATEWAY_LIMITS.messageBytes) {
      this.stop(channel, 'overloaded');
      return;
    }
    if (channel.stage === 'ticket') {
      if (
        binary ||
        bytes.length > WEB_CLIENT_GATEWAY_LIMITS.authenticationBytes
      ) {
        this.stop(channel, 'protocol_error');
        return;
      }
      // 单一 ticket 字段；重复属性、额外属性与转义别名均不接受。
      const match =
        /^\s*\{\s*"ticket"\s*:\s*"([A-Za-z0-9_-]{43})"\s*\}\s*$/.exec(
          bytes.toString('utf8'),
        );
      if (!match) {
        this.stop(channel, 'protocol_error');
        return;
      }
      channel.stage = 'authorizing';
      void this.authorize(channel, match[1]);
      return;
    }
    if (!binary || ['authorizing', 'opening'].includes(channel.stage)) {
      this.stop(channel, 'protocol_error');
      return;
    }
    if (channel.stage === 'request') {
      try {
        const claim = channel.claim!;
        if (claim.phase === 'rendezvous')
          validatePunchHoleRequest(bytes, claim);
        else validateRequestRelay(bytes, claim);
        channel.stage = 'opening';
        void this.openUpstream(channel, bytes);
      } catch {
        this.stop(channel, 'protocol_error');
      }
    } else if (channel.stage === 'opaque' && channel.upstream) {
      this.forward(channel, channel.upstream, bytes);
    } else {
      // ID 通道只转发一个已授权目标的查询，不能用第二包查询其它设备。
      this.stop(channel, 'protocol_error');
    }
  }

  private async authorize(channel: Channel, ticket: string): Promise<void> {
    try {
      const claim = await this.sessions.consumeTicket(ticket);
      channel.claim = claim;
      if (channel.stopped || this.destroyed) {
        this.endGrant(claim.sessionGuid, 'client_closed');
        return;
      }
      channel.detach = this.sessions.attach(claim.sessionGuid, (reason) => {
        this.stop(channel, reason ?? 'authorization_revoked', false, true);
      });
      this.unauthenticated.delete(channel);
      channel.stage = 'request';
      this.arm(channel, WEB_CLIENT_GATEWAY_LIMITS.handshakeMs);
      channel.browser.send('{"ready":true}', (error) => {
        if (error) this.stop(channel, 'client_closed');
      });
    } catch {
      this.stop(channel, 'authorization_revoked');
    }
  }

  private async openUpstream(channel: Channel, request: Buffer): Promise<void> {
    try {
      const claim = channel.claim!;
      await this.sessions.ensureValid(claim.sessionGuid);
      if (channel.stopped || this.destroyed) return;
      const upstream = new WebSocket(
        this.configuration.getUpstream(claim.phase),
        {
          perMessageDeflate: false,
          maxPayload: WEB_CLIENT_GATEWAY_LIMITS.messageBytes,
          handshakeTimeout: WEB_CLIENT_GATEWAY_LIMITS.handshakeMs,
          followRedirects: false,
        },
      );
      channel.upstream = upstream;
      upstream.once('upgrade', (response) => {
        channel.upstreamSocket = response.socket;
      });
      upstream.on('error', (error: unknown) =>
        this.stop(
          channel,
          messageTooLarge(error) ? 'overloaded' : 'upstream_error',
        ),
      );
      upstream.on('close', () => {
        const handoff =
          claim.phase === 'rendezvous' && channel.replied && !channel.refused;
        this.stop(channel, 'upstream_closed', false, handoff);
      });
      upstream.on('message', (data, binary) => {
        this.receiveUpstream(channel, asBuffer(data), binary);
      });
      await new Promise<void>((resolve, reject) => {
        upstream.once('open', resolve);
        upstream.once('error', reject);
        upstream.once('close', () => reject(new Error('Upstream closed')));
      });
      if (channel.stopped || this.destroyed) return;
      if (claim.phase === 'relay') {
        await this.sessions.markRelayOpen(claim.sessionGuid);
        if (channel.stopped || this.destroyed) return;
        channel.stage = 'opaque';
        if (channel.timer) clearTimeout(channel.timer);
        channel.timer = undefined;
      } else channel.stage = 'reply';
      this.forward(channel, upstream, request);
    } catch {
      this.stop(channel, 'upstream_error');
    }
  }

  private receiveUpstream(
    channel: Channel,
    bytes: Buffer,
    binary: boolean,
  ): void {
    if (channel.stopped) return;
    if (!binary || bytes.length > WEB_CLIENT_GATEWAY_LIMITS.messageBytes) {
      this.stop(channel, binary ? 'overloaded' : 'protocol_error');
      return;
    }
    if (channel.stage === 'reply' && !channel.replied) {
      try {
        const reply = readRendezvousReply(bytes);
        if (!reply.refused)
          this.sessions.bindRelay(channel.claim!.sessionGuid, reply.relayUuid);
        channel.replied = true;
        channel.refused = reply.refused;
        if (channel.timer) clearTimeout(channel.timer);
        channel.timer = undefined;
        this.forward(channel, channel.browser, bytes, reply.refused);
      } catch {
        this.stop(channel, 'protocol_error');
      }
    } else if (channel.stage === 'opaque') {
      this.forward(channel, channel.browser, bytes);
    } else this.stop(channel, 'protocol_error');
  }

  private forward(
    channel: Channel,
    destination: WebSocket,
    bytes: Buffer,
    finish = false,
  ): void {
    if (
      destination.readyState !== WebSocket.OPEN ||
      destination.bufferedAmount + bytes.length >
        WEB_CLIENT_GATEWAY_LIMITS.bufferedBytes
    ) {
      this.stop(channel, 'overloaded');
      return;
    }
    destination.send(bytes, { binary: true }, (error) => {
      if (error) this.stop(channel, 'upstream_error');
      else if (finish) this.stop(channel, 'upstream_closed');
    });
  }

  private arm(channel: Channel, milliseconds: number): void {
    if (channel.timer) clearTimeout(channel.timer);
    channel.timer = setTimeout(
      () => this.stop(channel, 'handshake_timeout'),
      milliseconds,
    );
    channel.timer.unref();
  }

  private stop(
    channel: Channel,
    reason: string,
    force = false,
    retainGrant = false,
  ): void {
    if (channel.stopped) return;
    channel.stopped = true;
    if (channel.timer) clearTimeout(channel.timer);
    channel.timer = undefined;
    channel.detach?.();
    channel.detach = undefined;
    this.unauthenticated.delete(channel);
    for (const socket of [channel.browser, channel.upstream]) {
      if (!socket || socket.readyState === WebSocket.CLOSED) continue;
      if (force || socket.readyState === WebSocket.CONNECTING)
        socket.terminate();
      else {
        // 先发送 close 帧，保留已发送的离线/拒绝答复；限时回收不响应的客户端。
        const code =
          reason === 'authentication_revoked'
            ? 4401
            : ['authorization_revoked', 'expired', 'pending_expired'].includes(
                  reason,
                )
              ? 4403
              : reason === 'protocol_error'
                ? 1008
                : reason === 'overloaded'
                  ? 1009
                  : [
                        'upstream_error',
                        'audit_unavailable',
                        'handshake_timeout',
                        'verification_timeout',
                      ].includes(reason)
                    ? 1011
                    : 1000;
        socket.close(code, 'Web client channel closed');
        const timer = setTimeout(() => socket.terminate(), 1000);
        timer.unref();
        socket.once('close', () => clearTimeout(timer));
      }
    }
    if (channel.claim && !retainGrant)
      this.endGrant(channel.claim.sessionGuid, reason);
  }

  private endGrant(sessionGuid: string, reason: string): void {
    void this.sessions.closeGrant(sessionGuid, reason).catch(() => {
      this.logger.warn('Unable to finish web client gateway audit');
    });
  }
}
