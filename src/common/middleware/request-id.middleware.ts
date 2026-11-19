import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  extractClientIp,
  isTrustedProxyEnabled,
} from '../utils/client-ip.util';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Upstream IDs are reused only when they are short printable tokens, so a
 * caller cannot inject control characters or oversized values into audit rows.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Request metadata recorded on every console audit written in its scope. */
export interface RequestContext {
  requestId: string;
  clientIp: string | null;
  userAgent: string | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** Express request carrying the correlation ID assigned by the middleware. */
export type RequestWithId = Request & { id?: string };

/**
 * Returns the ID of the HTTP request being handled, or undefined outside a
 * request scope (e.g. WebSocket handlers or scheduled jobs).
 */
export function getCurrentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

/**
 * Returns the correlation ID, client IP and User-Agent of the HTTP request
 * being handled, or undefined outside a request scope.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/** Reuses a well-formed upstream request ID or generates a new UUID. */
export function resolveRequestId(header: unknown): string {
  return typeof header === 'string' && VALID_REQUEST_ID.test(header)
    ? header
    : randomUUID();
}

/**
 * Assigns a correlation ID to every HTTP request. The ID is exposed as
 * `request.id`, returned in the `X-Request-Id` response header and bound to
 * the async context together with the client IP (see `TRUSTED_PROXY`) and
 * User-Agent, so every console audit written while handling the request
 * (guard denials, interceptor records and service-level events) shares the
 * same `requestId`, `clientIp` and `userAgent`.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(request.headers['x-request-id']);
  (request as RequestWithId).id = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  const userAgent = request.headers['user-agent'];
  requestContextStorage.run(
    {
      requestId,
      clientIp: extractClientIp(request, isTrustedProxyEnabled()),
      userAgent: userAgent || null,
    },
    next,
  );
}
