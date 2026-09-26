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
 * Verifies that the request contains a valid JWT token
 *
 * Permission rules:
 * All routes that require authentication use this guard
 *
 * Validation logic:
 * Checks the @Public decorator via Reflector and skips authentication for public routes
 */
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check whether this is a public endpoint
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
      throw err instanceof Error
        ? err
        : new UnauthorizedException('Please log in first');
    }
    if (!user) {
      throw new UnauthorizedException('Please log in first');
    }
    return user;
  }
}
