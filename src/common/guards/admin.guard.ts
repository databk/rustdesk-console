import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User, UserStatus } from '../../modules/user/entities/user.entity';

@Injectable()
/**
 * AdminGuard
 * 验证用户是否具有管理员权限
 *
 * 权限规则：
 * 只有管理员才能访问的路由会使用此守卫
 *
 * 验证逻辑：
 * 读取数据库中的当前用户状态和 isAdmin 字段，不信任 JWT 内的旧权限状态
 */
export class AdminGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string } }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('请先登录');
    }

    if (!user.id) {
      throw new ForbiddenException('授权服务不可用');
    }

    const currentUser = await this.dataSource.getRepository(User).findOne({
      where: { guid: user.id },
      select: ['guid', 'isAdmin', 'status'],
    });
    const isAdmin =
      currentUser?.isAdmin === true && currentUser.status === UserStatus.ACTIVE;

    if (!isAdmin) {
      throw new ForbiddenException('无权限访问，需要管理员权限');
    }

    return true;
  }
}
