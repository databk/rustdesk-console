import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
/**
 * JwtAuthGuard
 * 验证请求是否包含有效的JWT令牌
 *
 * 权限规则：
 * 所有需要认证的路由都会使用此守卫
 *
 * 验证逻辑：
 * 通过Reflector检查@Public装饰器，如果是公开路由则跳过认证
 */
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // 检查是否是公开接口
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err) {
      throw err instanceof Error ? err : new UnauthorizedException('请先登录');
    }
    if (!user) {
      throw new UnauthorizedException('请先登录');
    }
    return user;
  }
}
