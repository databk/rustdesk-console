import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import {
  CONSOLE_AUDIT_ACTION_KEY,
  ConsoleAuditActionMetadata,
  isConsoleAuditRecorded,
  resolveConsoleAuditAction,
  resolveConsoleAuditTargetGuid,
  resolveConsoleAuditTargetType,
} from '../decorators/console-audit-action.decorator';
import { SKIP_CONSOLE_AUDIT_KEY } from '../decorators/skip-console-audit.decorator';
import { RbacAuditService } from '../services/rbac-audit.service';

type AuditedRequest = Request & {
  id?: string;
  user?: { id?: string };
  params?: Record<string, string>;
  query?: Record<string, unknown>;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class ConsoleAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ConsoleAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: RbacAuditService,
  ) {}

  /** Audits annotated mutations after execution and records post-guard denials. */
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
        await this.recordResponse(request, metadata, response);
        return response;
      }),
      catchError((error: unknown) => {
        if (
          isConsoleAuditRecorded(error) ||
          !this.isAuthorizationError(error)
        ) {
          return throwError(() => error);
        }
        return from(this.recordDenial(request, metadata, error)).pipe(
          mergeMap(() => throwError(() => error)),
        );
      }),
    );
  }

  /** Persists a successful or business-failed response without breaking it. */
  private async recordResponse(
    request: AuditedRequest,
    metadata: ConsoleAuditActionMetadata,
    response: unknown,
  ): Promise<void> {
    try {
      const reason = this.failureReason(metadata, response);
      if (reason) {
        await this.auditService.recordDenied({
          actorUserGuid: request.user?.id,
          targetType: resolveConsoleAuditTargetType(metadata),
          targetGuid: resolveConsoleAuditTargetGuid(
            metadata,
            request,
            response,
          ),
          action: resolveConsoleAuditAction(metadata, request),
          reason,
          requestId: request.id ?? null,
        });
        return;
      }

      await this.auditService.record({
        actorUserGuid: request.user?.id,
        targetType: resolveConsoleAuditTargetType(metadata),
        targetGuid: resolveConsoleAuditTargetGuid(metadata, request, response),
        action: resolveConsoleAuditAction(metadata, request),
        result: 'allowed',
        afterState: this.buildAfterState(metadata, request, response),
        requestId: request.id ?? null,
      });
    } catch (error: unknown) {
      this.warn(error);
    }
  }

  /** Records an authorization failure raised after the RBAC guard. */
  private async recordDenial(
    request: AuditedRequest,
    metadata: ConsoleAuditActionMetadata,
    error: unknown,
  ): Promise<void> {
    try {
      await this.auditService.recordDenied({
        actorUserGuid: request.user?.id,
        targetType: resolveConsoleAuditTargetType(metadata),
        targetGuid: resolveConsoleAuditTargetGuid(metadata, request),
        action: resolveConsoleAuditAction(metadata, request),
        reason: error instanceof Error ? error.message : String(error),
        requestId: request.id ?? null,
      });
    } catch (auditError: unknown) {
      this.warn(auditError);
    }
  }

  /** Builds the after-state from a custom resolver, body, and query fields. */
  private buildAfterState(
    metadata: ConsoleAuditActionMetadata,
    request: AuditedRequest,
    response: unknown,
  ): unknown {
    if (metadata.afterState) {
      return metadata.afterState(request, response);
    }
    if (metadata.includeBody === false) {
      return undefined;
    }

    const state: unknown = request.body;
    if (!metadata.includeQueryFields?.length) {
      return state;
    }

    const queryState: Record<string, unknown> = {};
    for (const field of metadata.includeQueryFields) {
      if (request.query?.[field] !== undefined) {
        queryState[field] = request.query[field];
      }
    }
    if (!Object.keys(queryState).length) {
      return state;
    }
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      return { ...(state as Record<string, unknown>), ...queryState };
    }
    return queryState;
  }

  /** Returns a business failure reason when the response marks one. */
  private failureReason(
    metadata: ConsoleAuditActionMetadata,
    response: unknown,
  ): string | null {
    if (!metadata.failureResponseField) return null;
    if (!response || typeof response !== 'object') return null;
    const value = (response as Record<string, unknown>)[
      metadata.failureResponseField
    ];
    if (typeof value === 'string' && value !== '') return value;
    return null;
  }

  /** Limits implicit denial auditing to authorization failures. */
  private isAuthorizationError(error: unknown): boolean {
    return (
      error instanceof ForbiddenException ||
      error instanceof UnauthorizedException
    );
  }

  /** Logs audit persistence failures without failing the request. */
  private warn(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Unable to persist console audit: ${message}`);
  }
}
