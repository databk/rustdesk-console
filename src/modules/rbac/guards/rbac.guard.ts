import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CONSOLE_AUDIT_ACTION_KEY,
  ConsoleAuditActionMetadata,
  resolveConsoleAuditAction,
  resolveConsoleAuditTargetGuid,
  resolveConsoleAuditTargetType,
} from '../decorators/console-audit-action.decorator';
import {
  REQUIRE_PERMISSION_KEY,
  REQUIRE_SUPER_ADMIN_KEY,
} from '../decorators/require-permission.decorator';
import { RbacAuditService } from '../services/rbac-audit.service';
import { RbacAuthorizationService } from '../services/rbac-authorization.service';

interface RequestWithUser {
  id?: string;
  user?: { id?: string };
  params?: Record<string, string>;
  body?: unknown;
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: RbacAuthorizationService,
    private readonly auditService: RbacAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiresSuperAdmin = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_SUPER_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if ((!permissions || permissions.length === 0) && !requiresSuperAdmin) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const userGuid = request.user?.id;
    if (!userGuid) {
      throw new ForbiddenException('Please log in first');
    }

    try {
      if (requiresSuperAdmin) {
        await this.authorizationService.requireSuperAdmin(userGuid);
      }
      for (const permission of permissions || []) {
        await this.authorizationService.requirePermission(userGuid, permission);
      }
      return true;
    } catch (error: unknown) {
      const metadata =
        this.reflector.getAllAndOverride<ConsoleAuditActionMetadata>(
          CONSOLE_AUDIT_ACTION_KEY,
          [context.getHandler(), context.getClass()],
        );
      await this.auditService.recordDenied({
        actorUserGuid: userGuid,
        targetType: metadata
          ? resolveConsoleAuditTargetType(metadata)
          : 'route',
        targetGuid: metadata
          ? resolveConsoleAuditTargetGuid(metadata, request)
          : (request.params?.guid ?? null),
        action: metadata
          ? resolveConsoleAuditAction(metadata, request)
          : permissions?.join(',') || 'super_admin',
        reason: error instanceof Error ? error.message : String(error),
        requestId: request.id,
      });
      throw error;
    }
  }
}
