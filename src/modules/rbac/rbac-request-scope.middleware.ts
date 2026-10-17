import type { NextFunction, Request, Response } from 'express';
import {
  createRbacRequestCache,
  rbacRequestStorage,
} from './rbac-request-scope';

/**
 * Opens the request-scoped RBAC cache for the duration of one HTTP request.
 * Every authorization lookup performed while handling the request (JWT
 * validation, RBAC guard, admin guard, handlers) reuses this cache instead
 * of re-querying the same users / role rows.
 */
export function rbacRequestScopeMiddleware(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  rbacRequestStorage.run(createRbacRequestCache(), next);
}
