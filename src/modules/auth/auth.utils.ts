import type { Request } from 'express';

/**
 * Extract the Bearer Token from the request's Authorization header
 *
 * @param req Express request object
 * @returns Token string, or null if missing or malformed
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
