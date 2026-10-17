import { AsyncLocalStorage } from 'node:async_hooks';
import type { User } from '../user/entities/user.entity';
import type { UserRoleAssignment } from './entities/user-role-assignment.entity';
import type { PermissionCode } from './constants/permission-catalog';

/**
 * Request-scoped snapshot of the users row used by every authorization check.
 * Only the columns consumed by RBAC decisions are loaded.
 */
export type UserStatusSnapshot = Pick<User, 'guid' | 'status' | 'isAdmin'>;

/** Role assignments and the effective permission codes they grant. */
export interface EffectiveRoleGrants {
  assignments: UserRoleAssignment[];
  effectivePermissionsByRole: Map<string, Set<PermissionCode>>;
}

/** Resolved authorization scope for a single permission code. */
export interface PermissionScope {
  global: boolean;
  deviceGroupGuids: Set<string>;
}

/**
 * Cache shared by every RBAC lookup performed while handling one HTTP
 * request. The cache lives exactly as long as the request, so entries can
 * never go stale across requests and no invalidation is required. Lookups
 * that run inside a transaction (EntityManager provided) bypass it entirely
 * to preserve transaction read consistency.
 */
export interface RbacRequestCache {
  users: Map<string, Promise<UserStatusSnapshot | null>>;
  roleGrants: Map<string, Promise<EffectiveRoleGrants>>;
  permissionScopes: Map<string, Promise<PermissionScope>>;
  protectedUsers: Map<string, Promise<boolean>>;
}

export const rbacRequestStorage = new AsyncLocalStorage<RbacRequestCache>();

export function createRbacRequestCache(): RbacRequestCache {
  return {
    users: new Map(),
    roleGrants: new Map(),
    permissionScopes: new Map(),
    protectedUsers: new Map(),
  };
}

/**
 * Returns the cache bound to the current HTTP request, or undefined when no
 * request scope is active (e.g. WebSocket handlers or scheduled jobs).
 */
export function getRbacRequestCache(): RbacRequestCache | undefined {
  return rbacRequestStorage.getStore();
}

/**
 * Shares an already-loaded users row with the rest of the request. Called by
 * AuthService.validateToken right after it refreshes the account state, so
 * downstream RBAC checks reuse the same snapshot instead of re-querying.
 */
export function cacheUserStatusSnapshot(snapshot: UserStatusSnapshot): void {
  const cache = rbacRequestStorage.getStore();
  if (cache) cache.users.set(snapshot.guid, Promise.resolve(snapshot));
}
