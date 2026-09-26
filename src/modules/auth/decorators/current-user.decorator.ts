import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentUser decorator
 * Extracts the current user info from the JWT token and injects it into controller method parameters
 *
 * Use case:
 * Used in controller method parameters in the auth module
 *
 * @param field Name of the user field to extract (optional)
 * @returns Decorator function
 *
 * @example
 * async method(@CurrentUser('id') userId: string)
 */
export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
