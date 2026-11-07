import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, mergeMap } from 'rxjs';
import {
  CONSOLE_AUDIT_ACTION_KEY,
  ConsoleAuditActionMetadata,
  resolveConsoleAuditTargetGuid,
  resolveConsoleAuditTargetType,
} from '../decorators/console-audit-action.decorator';
import { SKIP_CONSOLE_AUDIT_KEY } from '../decorators/skip-console-audit.decorator';
import { RbacAuditService } from '../services/rbac-audit.service';

type AuditedRequest = Request & {
  id?: string;
  user?: { id?: string };
  params?: Record<string, string>;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
    const metadata =
      this.reflector.getAllAndOverride<ConsoleAuditActionMetadata>(
        CONSOLE_AUDIT_ACTION_KEY,
        [context.getHandler(), context.getClass()],
      );
    if (
      skip ||
      !metadata ||
      !request.user?.id ||
      !MUTATING_METHODS.has(request.method)
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap(async (response: unknown): Promise<unknown> => {
        try {
          await this.auditService.record({
            actorUserGuid: request.user?.id,
            targetType: resolveConsoleAuditTargetType(metadata),
            targetGuid: resolveConsoleAuditTargetGuid(metadata, request),
            action: metadata.action,
            result: 'allowed',
            afterState:
              metadata.includeBody === false ? undefined : request.body,
            requestId: request.id ?? null,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(`Unable to persist console audit: ${message}`);
        }
        return response;
      }),
    );
  }
}
