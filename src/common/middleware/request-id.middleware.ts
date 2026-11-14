import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Upstream IDs are reused only when they are short printable tokens, so a
 * caller cannot inject control characters or oversized values into audit rows.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const requestIdStorage = new AsyncLocalStorage<string>();

/** Express request carrying the correlation ID assigned by the middleware. */
export type RequestWithId = Request & { id?: string };

/**
 * Returns the ID of the HTTP request being handled, or undefined outside a
 * request scope (e.g. WebSocket handlers or scheduled jobs).
 */
export function getCurrentRequestId(): string | undefined {
  return requestIdStorage.getStore();
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
 * the async context, so every console audit written while handling the
 * request (guard denials, interceptor records and service-level events)
 * shares the same `requestId`.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(request.headers['x-request-id']);
  (request as RequestWithId).id = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  requestIdStorage.run(requestId, next);
}
