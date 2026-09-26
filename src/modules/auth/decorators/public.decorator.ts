import { SetMetadata } from '@nestjs/common';

/**
 * Public decorator
 * Marks a route as public, accessible without JWT authentication
 *
 * Use case:
 * For routes in the auth module that do not require authentication
 *
 * @param field Name of the user field to extract (optional)
 * @returns Decorator function
 *
 * @example
 * @Public() @Post('login')
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
