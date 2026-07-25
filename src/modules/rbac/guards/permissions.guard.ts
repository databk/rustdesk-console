import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * 已认证用户在 request.user 上的最小形态
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  email?: string;
  isAdmin?: boolean;
  jti?: string;
  /** 角色 code 列表（来自 JWT 快照） */
  roles?: string[];
  /** 权限码列表（来自 JWT 快照） */
  permissions?: string[];
}

/**
 * 权限守卫
 *
 * 全局注册（APP_GUARD），与全局 JwtAuthGuard 协作：
 * 1. 通过 Reflector 读取 @RequirePermissions 元数据；无元数据则放行。
 * 2. request.user 缺失 -> 403。
 * 3. user.isAdmin === true -> 放行（超管快速通道）。
 * 4. 校验 user.permissions 包含全部所需权限码（AND），否则 403。
 *
 * 权限码来自登录时写入 JWT 的快照，鉴权全程内存比较，无 DB 查询。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('请先登录');
    }

    // 超管快速通道
    if (user.isAdmin === true) {
      return true;
    }

    const userPermissions = user.permissions ?? [];
    const satisfied = required.every((code) =>
      userPermissions.includes(code),
    );

    if (!satisfied) {
      throw new ForbiddenException('无权限访问，缺少所需权限');
    }

    return true;
  }
}
