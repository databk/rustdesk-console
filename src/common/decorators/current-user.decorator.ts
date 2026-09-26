import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentUser decorator
 * Extracts the current user info from the JWT token and injects it into controller method parameters
 *
 * Use case:
 * Used in controller method parameters to automatically inject the specified field of the current user
 *
 * @param field name of the user field to extract (optional)
 * @returns decorator function
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
