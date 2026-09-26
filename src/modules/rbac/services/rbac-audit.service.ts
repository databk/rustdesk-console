import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
  /(password|pass(word)?|token|secret|verifier|credential|authorization|api[_-]?key|private[_-]?key|current[_-]?code|tfa[_-]?code|verification[_-]?code|otp[_-]?code|recovery[_-]?code|^code$)/i;

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
      targetGuid: event.targetGuid ?? null,
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
      query.andWhere('audit.action LIKE :action', {
        action: `%${filters.action}%`,
      });
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

  private serializeState(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(this.redact(value));
  }

  private parseState(value: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

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
    if (value === undefined || value === null) return DEFAULT_CURRENT;
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_CURRENT;
    return Math.floor(value);
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
