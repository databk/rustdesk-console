import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, catchError, defer, mergeMap } from 'rxjs';
import { SKIP_CONSOLE_AUDIT_KEY } from '../decorators/skip-console-audit.decorator';
import { RbacAuditService } from '../services/rbac-audit.service';
import {
  buildRouteAction,
  resolveTargetTypeFromRoute,
} from '../constants/audit-action.constants';

type AuditedRequest = Request & {
  user?: { id?: string; username?: string };
  params?: Record<string, string>;
  route?: { path?: string };
};

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class ConsoleAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ConsoleAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: RbacAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_CONSOLE_AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      skip ||
      !request.user?.id ||
      !AUDITED_METHODS.has(request.method)
    ) {
      return next.handle();
    }

    const base = this.buildAuditBase(request);

    return next.handle().pipe(
      mergeMap(async (response: unknown): Promise<unknown> => {
        await this.persist({
          ...base,
          result: 'allowed',
        });
        return response;
      }),
      catchError((error: unknown) =>
        defer(async () => {
          const reason =
            error instanceof Error ? error.message : String(error);
          await this.persist({
            ...base,
            result: 'denied',
            reason,
          });
          throw error;
        }),
      ),
    );
  }

  private buildAuditBase(request: AuditedRequest) {
    const route = request.route as { path?: string } | undefined;
    const routePath = route?.path || request.path;
    const basePath = request.baseUrl || '';
    const rawTarget = basePath.replace(/^\/api\/?/, '').split('/')[0];
    return {
      actorUserGuid: request.user?.id ?? null,
      actorUsername: request.user?.username ?? null,
      targetType: resolveTargetTypeFromRoute(rawTarget),
      targetGuid:
        request.params?.guid ||
        request.params?.uuid ||
        request.params?.id ||
        null,
      action: buildRouteAction(request.method, basePath, routePath),
      ip: this.extractIp(request),
      userAgent: this.extractUserAgent(request),
      afterState: request.body,
    };
  }

  private async persist(event: {
    actorUserGuid: string | null;
    actorUsername: string | null;
    targetType: string;
    targetGuid: string | null;
    action: string;
    ip: string | null;
    userAgent: string | null;
    afterState: unknown;
    result: 'allowed' | 'denied';
    reason?: string;
  }): Promise<void> {
    try {
      await this.auditService.record(event);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to persist console audit: ${message}`);
    }
  }

  private extractIp(request: AuditedRequest): string | null {
    if (request.ip) return request.ip;
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
    return null;
  }

  private extractUserAgent(request: AuditedRequest): string | null {
    const header = request.headers['user-agent'];
    return typeof header === 'string' ? header : null;
  }
}
