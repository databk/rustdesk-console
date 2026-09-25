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
import { SKIP_CONSOLE_AUDIT_KEY } from '../decorators/skip-console-audit.decorator';
import { RbacAuditService } from '../services/rbac-audit.service';

type AuditedRequest = Request & {
  user?: { id?: string };
  params?: Record<string, string>;
  route?: { path?: string };
};

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
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap(async (response) => {
        try {
          const routePath = request.route?.path || request.path;
          const basePath = request.baseUrl || '';
          const targetType = basePath.replace(/^\/api\/?/, '').split('/')[0] || 'route';
          const targetGuid =
            request.params?.guid || request.params?.uuid || request.params?.id || null;
          await this.auditService.record({
            actorUserGuid: request.user?.id,
            targetType,
            targetGuid,
            action: `${request.method} ${basePath}${routePath}`,
            result: 'allowed',
            afterState: request.body,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Unable to persist console audit: ${message}`);
        }
        return response;
      }),
    );
  }
}
