import { SetMetadata } from '@nestjs/common';

/**
 * Public decorator
 * Marks a route as public, accessible without JWT authentication
 *
 * Use case:
 * For routes that do not require authentication, such as login and registration
 *
 * @param field name of the user field to extract (optional)
 * @returns decorator function
 *
 * @example
 * @Public() @Post('login')
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
