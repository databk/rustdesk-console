import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
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
    pageSize?: number;
    current?: number;
    created_at?: string;
  }): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const pageSize = filters.pageSize || 20;
    const current = filters.current || 1;
    const query = this.repository.createQueryBuilder('audit');
    if (filters.operator) {
      query.andWhere('audit.actorUserGuid LIKE :operator', {
        operator: `%${filters.operator}%`,
      });
    }
    if (filters.created_at) {
      query.andWhere('audit.createdAt >= :createdAt', {
        createdAt: new Date(filters.created_at),
      });
    }
    const [rows, total] = await query
      .orderBy('audit.createdAt', 'DESC')
      .skip((current - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      data: rows.map((row) => ({
        guid: row.guid,
        actor_user_guid: row.actorUserGuid,
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
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (
        /(password|token|secret|verifier|credential|authorization)/i.test(key)
      ) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = this.redact(item);
      }
    }
    return result;
  }
}
