import type { Request } from 'express';

/**
 * 从请求的 Authorization header 中提取 Bearer Token
 *
 * @param req Express 请求对象
 * @returns Token 字符串，不存在或格式不正确时返回 null
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
