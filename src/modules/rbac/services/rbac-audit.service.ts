import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { ConsoleAudit } from '../entities/console-audit.entity';

export interface RbacAuditEvent {
  actorUserGuid?: string | null;
  targetType: string;
  targetGuid?: string | null;
  action: string;
  result: 'allowed' | 'denied';
  reason?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  requestId?: string | null;
}

interface ConsoleAuditQueryRaw {
  audit_guid?: string;
  guid?: string;
  actor_user_name?: string | null;
}

const SENSITIVE_STATE_KEY =
  /(password|pass(word)?|token|secret|verifier|credential|authorization|api[_-]?key|private[_-]?key|current[_-]?code|tfa[_-]?code|verification[_-]?code|otp[_-]?code|recovery[_-]?code|^code$|^key$)/i;
/** Keep serialized state below the 65,535-byte MySQL TEXT limit. */
const MAX_STATE_BYTES = 60_000;
const MAX_STATE_PREVIEW_BYTES = MAX_STATE_BYTES - 128;

const MAX_TARGET_GUID_LENGTH = 255;

/**
 * Historical console audit records used HTTP method and route strings. Keep
 * exact-action searches working across both formats after the canonical rename.
 */
const ACTION_ALIASES: Record<string, string[]> = {
  'auth.logout': ['POST /api/logout'],
  'auth.2fa.setup': ['POST /api/2fa/setup'],
  'auth.2fa.verify': ['POST /api/2fa/verify'],
  'auth.2fa.disable': ['DELETE /api/2fa'],
  'auth.passkey.register': ['POST /api/passkey/register/verify'],
  'auth.passkey.delete': ['DELETE /api/passkey/:guid'],
  'auth.passkey.tfa_update': ['POST /api/passkey/tfa'],
  'auth.session.revoke': ['DELETE /api/sessions/:jti'],
  'user.create': ['POST /api/users'],
  'user.invite': ['POST /api/users/invite'],
  'user.update': ['PATCH /api/users/:guid'],
  'user.delete': ['DELETE /api/users/:guid'],
  'user.profile.update': ['PATCH /api/users/me'],
  'user.password.update': ['PATCH /api/users/me/password'],
  'user.avatar.update': ['POST /api/users/me/avatar'],
  'user.avatar.delete': ['DELETE /api/users/me/avatar'],
  'user.status.batch_update': ['PATCH /api/users/batch/status'],
  'user.security.batch_update': ['PATCH /api/users/batch/security'],
  'user.session.batch_revoke': ['DELETE /api/users/batch/sessions'],
  'user.security.update': ['PATCH /api/users/:guid/security'],
  'user.session.revoke': ['DELETE /api/users/:guid/sessions'],
  'user_role.replace': ['PUT /api/users/:guid/roles'],
  'role.create': ['POST /api/roles'],
  'role.update': ['PATCH /api/roles/:guid'],
  'role.delete': ['DELETE /api/roles/:guid'],
  'device.update': ['PATCH /api/devices/:guid'],
  'device.delete': ['DELETE /api/devices/:guid'],
  'device.restore': ['POST /api/devices/tombstones/:uuid/restore'],
  'device.disconnect': ['POST /api/devices/:uuid/disconnect'],
  'device.status.batch_update': ['PATCH /api/devices/status'],
  'device_group.create': ['POST /api/device-groups'],
  'device_group.update': ['PATCH /api/device-groups/:guid'],
  'device_group.delete': ['DELETE /api/device-groups/:guid'],
  'device_group.member_add': ['POST /api/device-groups/:guid'],
  'device_group.member_remove': ['DELETE /api/device-groups/:guid/devices'],
  'strategy.create': ['POST /api/strategies'],
  'strategy.update': ['PATCH /api/strategies/:guid'],
  'strategy.delete': ['DELETE /api/strategies/:guid'],
  'strategy.assign': ['POST /api/strategies/:guid/assign'],
  'strategy.unassign': ['POST /api/strategies/:guid/unassign'],
  'user_group.create': ['POST /api/user-groups'],
  'user_group.update': ['PUT /api/user-groups/:guid'],
  'user_group.delete': ['DELETE /api/user-groups/:guid'],
  'user_group.member_add': ['POST /api/user-groups/:guid/users'],
  'settings.general.update': ['PUT /api/settings/general'],
  'settings.smtp.update': ['PUT /api/settings/smtp'],
  'settings.smtp.test': ['POST /api/settings/smtp/test'],
  'settings.ldap.update': ['PUT /api/settings/ldap'],
  'settings.ldap.test': ['POST /api/settings/ldap/test'],
  'settings.server_management.update': ['PUT /api/settings/server-management'],
  'settings.web_client.update': ['PUT /api/settings/web-client'],
  'oidc_provider.create': ['POST /api/oidc-providers'],
  'oidc_provider.sort': ['PATCH /api/oidc-providers/sort'],
  'oidc_provider.update': ['PATCH /api/oidc-providers/:guid'],
  'oidc_provider.delete': ['DELETE /api/oidc-providers/:guid'],
  'oidc_provider.toggle': ['PATCH /api/oidc-providers/:guid/toggle'],
  'oidc_provider.test': ['POST /api/oidc-providers/:guid/test'],
  'server.session.disconnect': [
    'DELETE /v1/sessions/:uuid',
    'DELETE /api/servers/:node/sessions/:uuid',
  ],
  'server.service.config.update': [
    'PUT /v1/services/:service/config',
    'PUT /api/servers/:node/services/:service/config',
  ],
  'server.bans.update': ['PUT /v1/bans', 'PUT /api/servers/:node/bans'],
  'server.peer.release': ['DELETE /v1/peers/:id'],
  'system_update.plan': ['POST /api/system-update/plans'],
  'system_update.job.create': ['POST /api/system-update/jobs'],
  'connection_audit.update': ['PATCH /api/audits/conn/:id'],
  'nexus.unbind': ['DELETE /api/nexus/auth/bind'],
  'nexus.build.create': ['POST /api/nexus/builds'],
  'nexus.build.delete': ['DELETE /api/nexus/builds/:uuid'],
  'nexus.login_session.create': ['POST /api/nexus/auth/login'],
};

@Injectable()
export class RbacAuditService {
  private readonly logger = new Logger(RbacAuditService.name);

  constructor(
    @InjectRepository(ConsoleAudit)
    private readonly repository: Repository<ConsoleAudit>,
  ) {}

  async record(
    event: RbacAuditEvent,
    manager?: EntityManager,
  ): Promise<ConsoleAudit> {
    const repository = manager?.getRepository(ConsoleAudit) || this.repository;
    const audit = repository.create({
      guid: uuidv4(),
      actorUserGuid: event.actorUserGuid ?? null,
      targetType: event.targetType,
      targetGuid: this.boundTargetGuid(event.targetGuid),
      action: event.action,
      result: event.result,
      reason: event.reason ?? null,
      beforeState: this.serializeState(event.beforeState),
      afterState: this.serializeState(event.afterState),
      requestId: event.requestId ?? null,
    });
    return repository.save(audit);
  }

  async recordDenied(event: Omit<RbacAuditEvent, 'result'>): Promise<void> {
    try {
      await this.record({ ...event, result: 'denied' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to persist denied RBAC audit: ${message}`);
    }
  }

  async query(filters: {
    operator?: string;
    action?: string;
    targetType?: string;
    result?: 'allowed' | 'denied';
    pageSize?: number;
    current?: number;
    startTime?: string;
    endTime?: string;
  }): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const pageSize = this.boundPageSize(filters.pageSize);
    const current = this.boundCurrent(filters.current);
    const query = this.repository
      .createQueryBuilder('audit')
      .leftJoin(User, 'actor', 'actor.guid = audit.actorUserGuid')
      .addSelect('actor.username', 'actor_user_name');
    if (filters.operator) {
      query.andWhere('actor.username LIKE :operator', {
        operator: `%${filters.operator}%`,
      });
    }
    if (filters.action) {
      const aliases = this.expandActionAliases(filters.action);
      query.andWhere(
        new Brackets((builder) => {
          aliases.forEach((alias, index) => {
            if (index === 0) {
              // The user's own input keeps substring semantics.
              builder.orWhere(`audit.action LIKE :action${index}`, {
                [`action${index}`]: `%${alias}%`,
              });
            } else {
              builder.orWhere(`audit.action = :action${index}`, {
                [`action${index}`]: alias,
              });
            }
          });
        }),
      );
    }
    if (filters.targetType) {
      query.andWhere('audit.targetType = :targetType', {
        targetType: filters.targetType,
      });
    }
    if (filters.result) {
      query.andWhere('audit.result = :result', { result: filters.result });
    }
    const startTime = this.parseDate(filters.startTime, 'start_time');
    const endTime = this.parseDate(filters.endTime, 'end_time');
    if (startTime) {
      query.andWhere('audit.createdAt >= :startTime', { startTime });
    }
    if (endTime) {
      query.andWhere('audit.createdAt <= :endTime', { endTime });
    }
    const total = await query.getCount();
    const { entities: rows, raw } = await query
      .orderBy('audit.createdAt', 'DESC')
      .skip((current - 1) * pageSize)
      .take(pageSize)
      .getRawAndEntities();
    const rawRows = raw as ConsoleAuditQueryRaw[];
    const actorNames = new Map(
      rawRows.map((item) => [
        item.audit_guid ?? item.guid,
        item.actor_user_name ?? null,
      ]),
    );
    return {
      data: rows.map((row) => ({
        guid: row.guid,
        actor_user_guid: row.actorUserGuid,
        actor_user_name: actorNames.get(row.guid) ?? null,
        target_type: row.targetType,
        target_guid: row.targetGuid,
        action: row.action,
        result: row.result,
        reason: row.reason,
        before_state: this.parseState(row.beforeState),
        after_state: this.parseState(row.afterState),
        request_id: row.requestId,
        created_at: row.createdAt,
      })),
      total,
    };
  }

  /** Expands exact canonical or historical action filters into both formats. */
  private expandActionAliases(action: string): string[] {
    const aliases = new Set<string>([action]);
    for (const [canonical, historical] of Object.entries(ACTION_ALIASES)) {
      if (action === canonical) {
        historical.forEach((alias) => aliases.add(alias));
      }
      if (historical.includes(action)) {
        aliases.add(canonical);
      }
    }
    return [...aliases];
  }

  /** Drops GUIDs that exceed the audited varchar column width. */
  private boundTargetGuid(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    if (value.length > MAX_TARGET_GUID_LENGTH) return null;
    return value;
  }

  private serializeState(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const serialized = JSON.stringify(this.redact(value));
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    if (byteLength <= MAX_STATE_BYTES) return serialized;

    let previewBytes = MAX_STATE_PREVIEW_BYTES;
    while (previewBytes > 0) {
      const preview = this.truncateUtf8(serialized, previewBytes);
      const result = JSON.stringify({
        truncated: true,
        original_bytes: byteLength,
        preview,
      });
      if (Buffer.byteLength(result, 'utf8') <= MAX_STATE_BYTES) return result;
      previewBytes -= 2048;
    }

    return JSON.stringify({ truncated: true, original_bytes: byteLength });
  }

  /** Truncates a string on a character boundary without exceeding maxBytes. */
  private truncateUtf8(value: string, maxBytes: number): string {
    let low = 0;
    let high = value.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    if (low > 0 && low < value.length) {
      const last = value.charCodeAt(low - 1);
      if (last >= 0xd800 && last <= 0xdbff) low -= 1;
    }
    return value.slice(0, low);
  }

  private parseState(value: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  /** Recursively replaces sensitive state values before persistence. */
  private redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date) return value.toJSON();
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_STATE_KEY.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = this.redact(item);
      }
    }
    return result;
  }

  private boundPageSize(value: number | undefined): number {
    const DEFAULT_PAGE_SIZE = 20;
    const MAX_PAGE_SIZE = 100;
    if (value === undefined || value === null) return DEFAULT_PAGE_SIZE;
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(Math.floor(value), MAX_PAGE_SIZE);
  }

  private boundCurrent(value: number | undefined): number {
    const DEFAULT_CURRENT = 1;
    const MAX_CURRENT = 100000;
    if (value === undefined || value === null) return DEFAULT_CURRENT;
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_CURRENT;
    return Math.min(Math.floor(value), MAX_CURRENT);
  }

  private parseDate(
    value: string | undefined,
    field: string,
  ): Date | undefined {
    if (!value) return undefined;
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!isDateOnly && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      throw new BadRequestException(
        `${field} must include a UTC designator (Z) or a timezone offset`,
      );
    }
    const parsed = new Date(isDateOnly ? `${value}T00:00:00.000Z` : value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} is not a valid date string`);
    }
    if (isDateOnly && parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${field} is not a valid date string`);
    }
    return parsed;
  }
}
