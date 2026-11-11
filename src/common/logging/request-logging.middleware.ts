import { Logger, type LogLevel } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * Status-based levels only; never add path allow/deny lists here.
 * Routine traffic, expired tokens (401) and probes (404) are debug;
 * anything else outside 2xx/3xx is a warning. 5xx stack traces are
 * already logged at error level by Nest's exception handler.
 */
export function requestLogLevel(status: number): LogLevel {
  if (status < 400 || status === 401 || status === 404) {
    return 'debug';
  }
  return 'warn';
}

/**
 * The backend usually sits behind the web container's reverse proxy, so the
 * socket address alone is the proxy. The forwarded address is shown next to
 * it for troubleshooting only; it is client-supplied and not trusted.
 */
function clientAddress(request: Request): string {
  const socketAddress = request.ip ?? '-';
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(',')[0]
    ?.trim();
  return first ? `${socketAddress} fwd=${first}` : socketAddress;
}

/**
 * Logs one line per request: method, path, status, duration, ip.
 * Only the path is logged; query strings and bodies may carry OIDC codes
 * and tokens.
 *
 * `close` fires both after a complete response and when the client
 * disconnects early. In the second case no status was sent, so the line
 * shows `aborted` instead and is logged at debug.
 */
export function requestLoggingMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();
  response.once('close', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const path = request.originalUrl.split('?')[0];
    const completed = response.writableFinished;
    const level = completed ? requestLogLevel(response.statusCode) : 'debug';
    const status = completed ? String(response.statusCode) : 'aborted';
    logger[level](
      `${request.method} ${path} ${status} ${durationMs.toFixed(1)}ms ${clientAddress(request)}`,
    );
  });
  next();
}
