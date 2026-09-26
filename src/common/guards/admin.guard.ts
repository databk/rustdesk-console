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
 * Verifies that the user has administrator privileges
 *
 * Permission rules:
 * Routes accessible only to administrators use this guard
 *
 * Validation logic:
 * Reads the current user status and isAdmin field from the database; does not trust the stale permission state inside the JWT
 */
export class AdminGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string } }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Please log in first');
    }

    if (!user.id) {
      throw new ForbiddenException('Authorization service unavailable');
    }

    const currentUser = await this.dataSource.getRepository(User).findOne({
      where: { guid: user.id },
      select: ['guid', 'isAdmin', 'status'],
    });
    const isAdmin =
      currentUser?.isAdmin === true && currentUser.status === UserStatus.ACTIVE;

    if (!isAdmin) {
      throw new ForbiddenException(
        'Access denied: administrator privileges required',
      );
    }

    return true;
  }
}
