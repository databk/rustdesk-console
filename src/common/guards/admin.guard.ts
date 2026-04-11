import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
/**
 * AdminGuard
 * 验证用户是否具有管理员权限
 *
 * 权限规则：
 * 只有管理员才能访问的路由会使用此守卫
 *
 * 验证逻辑：
 * 检查用户信息中的isAdmin字段
 */
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('请先登录');
    }

    if (!user.isAdmin) {
      throw new ForbiddenException('无权限访问，需要管理员权限');
    }

    return true;
  }
}
