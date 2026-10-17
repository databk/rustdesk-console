import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
/**
 * AdminGuard
 * Verifies that the user has administrator privileges
 *
 * Permission rules:
 * Routes accessible only to administrators use this guard
 *
 * Validation logic:
 * Relies on request.user.isAdmin, which the JWT strategy refreshed from the
 * database at the start of this very request (AuthService.validateToken).
 * Re-querying the same users row here would only narrow an unavoidable
 * TOCTOU window without adding real security.
 */
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string; isAdmin?: boolean } }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Please log in first');
    }

    if (!user.id) {
      throw new ForbiddenException('Authorization service unavailable');
    }

    if (user.isAdmin !== true) {
      throw new ForbiddenException(
        'Access denied: administrator privileges required',
      );
    }

    return true;
  }
}
