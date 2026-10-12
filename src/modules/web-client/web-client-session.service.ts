import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import {
  WEB_CLIENT_BROWSER_EVENTS,
  WebClientEventDto,
} from './dto/web-client.dto';
import {
  WebClientActor,
  WebClientAuthorizationService,
  WebClientKind,
  normalizeWebClientTarget,
} from './web-client-authorization.service';
import { WebClientService } from './web-client.service';

export interface WebClientGrant {
  sessionGuid: string;
  gatewayPath: '/api/web-client/socket';
  tickets: { rendezvous: string; relay: string };
  expiresAt: string;
}
export interface GatewayClaim {
  sessionGuid: string;
  targetId: string;
  kind: WebClientKind;
  phase: 'rendezvous' | 'relay';
  relayUuid?: string;
  serverPublicKey: string;
}
interface Session {
  guid: string;
  actor: WebClientActor;
  targetId: string;
  peerUuid: string;
  kind: WebClientKind;
  parentGuid?: string;
  createdAt: number;
  expiresAt: number;
  profileIdentity: string;
  serverPublicKey: string;
  relayUuid?: string;
  active: boolean;
  ticketHashes: string[];
  sockets: Set<(reason?: string) => void>;
  reports: number;
  reportWindow: number;
  windowReports: number;
}
interface Ticket {
  sessionGuid: string;
  phase: GatewayClaim['phase'];
  expiresAt: number;
}

const TERMINATION_REASONS = new Set([
  'cancelled',
  'admin_disconnect',
  'client_closed',
  'upstream_closed',
  'upstream_error',
  'protocol_error',
  'overloaded',
  'authorization_revoked',
  'authentication_revoked',
  'verification_timeout',
  'handshake_timeout',
  'expired',
  'pending_expired',
  'parent_closed',
  'application_shutdown',
  'audit_unavailable',
  'connection_closed',
]);

@Injectable()
export class WebClientSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebClientSessionService.name);
  private readonly sessions = new Map<string, Session>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly reservations = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;
  private stopped = false;
  private readonly pendingTimeouts = new Set<symbol>();
  private emergencyAudit?: Promise<void>;
  private verificationEpoch = 0;

  constructor(
    private readonly authorization: WebClientAuthorizationService,
    private readonly configuration: WebClientService,
    private readonly audit: RbacAuditService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.revalidateSessions();
    }, 15_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.persistTerminations(
      this.invalidate(
        [...this.sessions.values()],
        () => 'application_shutdown',
      ),
    );
    if (this.emergencyAudit) await this.emergencyAudit;
  }

  async create(
    actor: WebClientActor,
    rawTargetId: string,
    kind: WebClientKind = 'desktop',
    parentGuid?: string,
  ): Promise<WebClientGrant> {
    const guid = randomUUID();
    const verificationEpoch = this.verificationEpoch;
    let reserved = false;
    let targetId: string | undefined;
    try {
      if (this.stopped || this.pendingTimeouts.size)
        throw new ServiceUnavailableException('Web client is unavailable');
      targetId = normalizeWebClientTarget(rawTargetId);
      this.reserve(actor.id);
      reserved = true;
      const configuration = this.configuration.requireConfiguration();
      const profileIdentity = this.profileIdentity();
      const parent =
        kind === 'file' ? this.owned(parentGuid ?? '', actor) : undefined;
      if (
        (kind !== 'desktop' && kind !== 'file') ||
        (kind === 'desktop' && parentGuid) ||
        (parent &&
          (parent.kind !== 'desktop' ||
            parent.targetId !== targetId ||
            !parent.active))
      )
        throw new ForbiddenException(
          'Web client parent session is unavailable',
        );
      if (parent) await this.ensureValid(parent.guid);
      const { peer, expiresAt: loginExpiry } = await this.withDeadline(() =>
        this.authorization.validate(actor, targetId!, kind),
      );
      const now = Date.now();
      const expiresAt = Math.min(
        now + 8 * 60 * 60 * 1000,
        loginExpiry,
        parent?.expiresAt ?? Infinity,
      );
      const session: Session = {
        guid,
        actor: { id: actor.id, jti: actor.jti },
        targetId,
        peerUuid: peer.uuid,
        kind,
        parentGuid,
        createdAt: now,
        expiresAt,
        profileIdentity,
        serverPublicKey: configuration.serverPublicKey,
        active: false,
        ticketHashes: [],
        sockets: new Set(),
        reports: 0,
        reportWindow: now,
        windowReports: 0,
      };
      // 准许审计失败时不签发可使用的票据。
      await this.record(session, 'request_allowed', 'server');
      if (
        this.stopped ||
        this.pendingTimeouts.size ||
        verificationEpoch !== this.verificationEpoch ||
        profileIdentity !== this.profileIdentity() ||
        expiresAt <= Date.now() ||
        (parent && this.sessions.get(parent.guid) !== parent)
      )
        throw new ForbiddenException(
          'Web client session is no longer available',
        );
      const rendezvous = randomBytes(32).toString('base64url');
      const relay = randomBytes(32).toString('base64url');
      for (const [phase, value] of [
        ['rendezvous', rendezvous],
        ['relay', relay],
      ] as const) {
        const hash = this.hash(value);
        session.ticketHashes.push(hash);
        this.tickets.set(hash, {
          sessionGuid: guid,
          phase,
          expiresAt: Math.min(Date.now() + 60_000, expiresAt),
        });
      }
      this.sessions.set(guid, session);
      return {
        sessionGuid: guid,
        gatewayPath: '/api/web-client/socket',
        tickets: { rendezvous, relay },
        expiresAt: new Date(expiresAt).toISOString(),
      };
    } catch (error: unknown) {
      // 只记录规范化且通过格式校验的申请 ID，不记录无效原始输入。
      try {
        if (this.pendingTimeouts.size) throw new ServiceUnavailableException();
        await this.withDeadline(() =>
          this.audit.record({
            actorUserGuid: actor.id,
            targetType: 'web_client_session',
            targetGuid: guid,
            requestId: guid,
            action: 'web_client.request_denied',
            result: 'denied',
            reason: 'Web client authorization rejected',
            afterState: {
              event: 'request_denied',
              source: 'server',
              kind,
              ...(targetId ? { targetId } : {}),
            },
          }),
        );
      } catch {
        this.logger.warn('Unable to persist web client denial audit');
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Web client authorization is unavailable',
      );
    } finally {
      if (reserved) this.releaseReservation(actor.id);
    }
  }

  async createFile(
    actor: WebClientActor,
    parentGuid: string,
  ): Promise<WebClientGrant> {
    let parent: Session;
    try {
      parent = this.owned(parentGuid, actor);
    } catch (error: unknown) {
      try {
        if (this.pendingTimeouts.size) throw new ServiceUnavailableException();
        await this.withDeadline(() =>
          this.audit.record({
            actorUserGuid: actor.id,
            targetType: 'web_client_session',
            targetGuid: parentGuid,
            requestId: parentGuid,
            action: 'web_client.request_denied',
            result: 'denied',
            reason: 'Web client parent session rejected',
            afterState: {
              kind: 'file',
              parentGuid,
              event: 'request_denied',
              source: 'server',
            },
          }),
        );
      } catch {
        this.logger.warn('Unable to persist web client denial audit');
      }
      throw error;
    }
    return this.create(actor, parent.targetId, 'file', parentGuid);
  }

  async consumeTicket(value: string): Promise<GatewayClaim> {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new ForbiddenException('Invalid web client ticket');
    const hash = this.hash(value);
    const ticket = this.tickets.get(hash);
    // 先删除再 await，两个同时握手不能重复消费。
    this.tickets.delete(hash);
    if (!ticket || ticket.expiresAt <= Date.now())
      throw new ForbiddenException('Invalid or expired web client ticket');
    const session = this.current(ticket.sessionGuid);
    if (ticket.phase === 'relay' && !session.relayUuid)
      throw new ForbiddenException('Relay has not been bound');
    await this.ensureValid(session.guid);
    this.assertCurrent(session);
    return {
      sessionGuid: session.guid,
      targetId: session.targetId,
      kind: session.kind,
      phase: ticket.phase,
      ...(session.relayUuid ? { relayUuid: session.relayUuid } : {}),
      serverPublicKey: session.serverPublicKey,
    };
  }

  bindRelay(sessionGuid: string, uuid: string): void {
    const session = this.current(sessionGuid);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        uuid,
      ) ||
      session.relayUuid ||
      [...this.sessions.values()].some(
        (other) => other.guid !== sessionGuid && other.relayUuid === uuid,
      )
    )
      throw new ForbiddenException('Invalid relay binding');
    session.relayUuid = uuid;
  }

  attach(sessionGuid: string, close: (reason?: string) => void): () => void {
    const session = this.current(sessionGuid);
    if (session.sockets.size >= 2)
      throw new ForbiddenException('Web client channel limit exceeded');
    session.sockets.add(close);
    return () => {
      session.sockets.delete(close);
    };
  }

  async markRelayOpen(sessionGuid: string): Promise<void> {
    const session = this.current(sessionGuid);
    await this.ensureValid(sessionGuid);
    if (session.active || !session.relayUuid)
      throw new ForbiddenException('Invalid relay lifecycle');
    try {
      await this.record(session, 'gateway_open', 'server');
    } catch {
      await this.closeGrant(sessionGuid, 'audit_unavailable');
      throw new ServiceUnavailableException('Web client audit is unavailable');
    }
    this.assertCurrent(session);
    session.active = true;
  }

  async ensureValid(sessionGuid: string): Promise<void> {
    const session = this.current(sessionGuid);
    try {
      const { expiresAt } = await this.withDeadline(() =>
        this.authorization.validate(
          session.actor,
          session.targetId,
          session.kind,
          session.peerUuid,
        ),
      );
      this.assertCurrent(session);
      session.expiresAt = Math.min(session.expiresAt, expiresAt);
      if (session.profileIdentity !== this.profileIdentity())
        throw new ForbiddenException('Web client configuration changed');
      if (session.parentGuid) {
        const parent = this.current(session.parentGuid);
        if (
          !parent.active ||
          parent.actor.id !== session.actor.id ||
          parent.actor.jti !== session.actor.jti
        )
          throw new ForbiddenException('Parent session is unavailable');
      }
      this.assertCurrent(session);
    } catch (error: unknown) {
      await this.closeGrant(
        sessionGuid,
        error instanceof UnauthorizedException
          ? 'authentication_revoked'
          : 'authorization_revoked',
      );
      throw error;
    }
  }

  async revalidateSessions(): Promise<void> {
    if (this.checking || this.stopped) return;
    this.checking = true;
    try {
      // 整轮也有5秒上限，避免多个慢查询让队尾会话长期不被复验。
      await this.withDeadline(async () => {
        for (const [hash, ticket] of this.tickets)
          if (ticket.expiresAt <= Date.now()) this.tickets.delete(hash);
        for (const session of [...this.sessions.values()]) {
          if (!this.sessions.has(session.guid)) continue;
          if (Date.now() >= session.expiresAt) {
            await this.closeGrant(session.guid, 'expired');
            continue;
          }
          if (!session.active && Date.now() - session.createdAt >= 120_000) {
            await this.closeGrant(session.guid, 'pending_expired');
            continue;
          }
          try {
            await this.ensureValid(session.guid);
          } catch {
            /* 已关闭，下一条继续复验。 */
          }
        }
      });
    } catch {
      // 有界验证超时已同步关闭全部 socket，不再次放行。
    } finally {
      this.checking = false;
    }
  }

  async report(
    actor: WebClientActor,
    sessionGuid: string,
    dto: WebClientEventDto,
  ): Promise<{ accepted: true }> {
    const session = this.owned(sessionGuid, actor);
    await this.ensureValid(sessionGuid);
    if (!WEB_CLIENT_BROWSER_EVENTS.includes(dto.event) || !session.active)
      throw new BadRequestException('Invalid web client event');
    const fileEvent = dto.event.startsWith('file_');
    if (
      fileEvent
        ? session.kind !== 'file' ||
          !dto.fileName ||
          dto.size === undefined ||
          !dto.direction
        : dto.fileName !== undefined ||
          dto.size !== undefined ||
          dto.direction !== undefined
    )
      throw new BadRequestException('Invalid web client event metadata');
    if (Date.now() - session.reportWindow >= 1000) {
      session.reportWindow = Date.now();
      session.windowReports = 0;
    }
    if (session.reports >= 1024 || session.windowReports >= 4)
      throw new HttpException(
        'Web client event limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    session.reports += 1;
    session.windowReports += 1;
    await this.record(
      session,
      dto.event,
      'browser',
      fileEvent
        ? { fileName: dto.fileName, size: dto.size, direction: dto.direction }
        : {},
    );
    this.assertCurrent(session);
    return { accepted: true };
  }

  async requireOwnedActive(actor: WebClientActor, guid: string): Promise<void> {
    const session = this.owned(guid, actor);
    if (!session.active || session.kind !== 'desktop')
      throw new ForbiddenException('Web client session is unavailable');
    await this.ensureValid(guid);
    this.assertCurrent(session);
    if (!session.active)
      throw new ForbiddenException('Web client session is unavailable');
  }

  async end(
    actor: WebClientActor,
    sessionGuid: string,
  ): Promise<{ ended: true }> {
    const session = this.sessions.get(sessionGuid);
    if (!session) return { ended: true };
    const self =
      session.actor.id === actor.id && session.actor.jti === actor.jti;
    if (!self)
      await this.withDeadline(() =>
        this.authorization.requireDisconnect(actor, session.peerUuid),
      );
    if (this.sessions.get(sessionGuid) !== session) return { ended: true };
    await this.closeGrant(
      sessionGuid,
      self ? 'cancelled' : 'admin_disconnect',
      actor.id,
    );
    return { ended: true };
  }

  async closeGrant(
    sessionGuid: string,
    rawReason: string,
    closedBy?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionGuid);
    if (!session) return;
    // 先不可逆结束和释放 socket；日志故障不能延长已撤销会话。
    const reason = TERMINATION_REASONS.has(rawReason)
      ? rawReason
      : 'connection_closed';
    const family = [
      session,
      ...[...this.sessions.values()].filter(
        (child) => child.parentGuid === sessionGuid,
      ),
    ];
    await this.persistTerminations(
      this.invalidate(family, (item) =>
        item === session ? reason : 'parent_closed',
      ),
      closedBy,
    );
  }

  private invalidate(
    items: Session[],
    reason: (session: Session) => string,
  ): { session: Session; reason: string }[] {
    const closed = items
      .filter((item) => this.sessions.get(item.guid) === item)
      .map((session) => ({ session, reason: reason(session) }));
    // 全部先失效，慢审计或同步 close 回调都不能保留其它子通道。
    for (const { session } of closed) {
      this.sessions.delete(session.guid);
      for (const hash of session.ticketHashes) this.tickets.delete(hash);
    }
    for (const { session, reason: closeReason } of closed) {
      for (const close of session.sockets) {
        try {
          close(closeReason);
        } catch {
          this.logger.warn('Unable to close web client channel');
        }
      }
      session.sockets.clear();
    }
    return closed;
  }

  private async persistTerminations(
    closed: { session: Session; reason: string }[],
    closedBy?: string,
  ): Promise<void> {
    for (let index = 0; index < closed.length; index++) {
      const { session, reason } = closed[index];
      try {
        await this.record(
          session,
          'session_ended',
          'server',
          { reason, ...(closedBy ? { closedBy } : {}) },
          closedBy,
        );
      } catch {
        this.logger.warn(
          `Unable to persist ${closed.length - index} web client termination audit(s)`,
        );
        return;
      }
    }
  }

  private async withDeadline<T>(operation: () => Promise<T>): Promise<T> {
    const id = Symbol();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve().then(operation);
    const settled = () => {
      this.pendingTimeouts.delete(id);
    };
    // TypeORM 无取消查询 API；迟到结果只释放健康门禁，不能恢复旧授权。
    void pending.then(settled, settled);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.pendingTimeouts.add(id);
        this.verificationEpoch += 1;
        const closed = this.invalidate(
          [...this.sessions.values()],
          () => 'verification_timeout',
        );
        if (closed.length) {
          const audit = this.persistTerminations(closed);
          this.emergencyAudit = audit;
          void audit.finally(() => {
            if (this.emergencyAudit === audit) this.emergencyAudit = undefined;
          });
        }
        reject(
          new ServiceUnavailableException('Web client verification timed out'),
        );
      }, 5000);
      timer.unref();
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private current(guid: string): Session {
    const session = this.sessions.get(guid);
    if (
      !session ||
      this.stopped ||
      session.expiresAt <= Date.now() ||
      (!session.active && Date.now() - session.createdAt >= 120_000)
    )
      throw new ForbiddenException('Web client session is unavailable');
    return session;
  }

  private assertCurrent(session: Session): void {
    if (this.current(session.guid) !== session)
      throw new ForbiddenException('Web client session is unavailable');
  }

  private owned(guid: string, actor: WebClientActor): Session {
    const session = this.current(guid);
    if (session.actor.id !== actor.id || session.actor.jti !== actor.jti)
      throw new ForbiddenException('Web client session is unavailable');
    return session;
  }

  private reserve(actorGuid: string): void {
    const pending = [...this.reservations.values()].reduce(
      (total, count) => total + count,
      0,
    );
    const userSessions = [...this.sessions.values()].filter(
      (session) => session.actor.id === actorGuid,
    ).length;
    const userPending = this.reservations.get(actorGuid) ?? 0;
    if (this.sessions.size + pending >= 256 || userSessions + userPending >= 8)
      throw new HttpException(
        'Web client session limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    this.reservations.set(actorGuid, userPending + 1);
  }

  private releaseReservation(actorGuid: string): void {
    const count = this.reservations.get(actorGuid) ?? 0;
    if (count <= 1) this.reservations.delete(actorGuid);
    else this.reservations.set(actorGuid, count - 1);
  }

  private hash(ticket: string): string {
    return createHash('sha256').update(ticket).digest('hex');
  }
  private profileIdentity(): string {
    return JSON.stringify([
      this.configuration.requireConfiguration(),
      this.configuration.getAllowedOrigin(),
      this.configuration.getUpstream('rendezvous'),
      this.configuration.getUpstream('relay'),
    ]);
  }

  private record(
    session: Session,
    event: string,
    source: 'server' | 'browser',
    metadata: Record<string, unknown> = {},
    actorGuid?: string,
  ): Promise<unknown> {
    return this.withDeadline(() =>
      this.audit.record({
        actorUserGuid: actorGuid ?? session.actor.id,
        targetType: 'web_client_session',
        targetGuid: session.guid,
        requestId: session.guid,
        action: `web_client.${event}`,
        result:
          event === 'remote_auth_failed' || event === 'file_failed'
            ? 'denied'
            : 'allowed',
        afterState: {
          targetId: session.targetId,
          peerUuid: session.peerUuid,
          kind: session.kind,
          parentGuid: session.parentGuid ?? null,
          event,
          source,
          occurredAt: new Date().toISOString(),
          ...metadata,
        },
      }),
    );
  }
}
