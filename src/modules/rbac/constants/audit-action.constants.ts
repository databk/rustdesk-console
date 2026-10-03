/**
 * Canonical audit target types. Persisted in `console_audits.target_type`.
 *
 * Manual audit sites should always reference these constants instead of raw
 * strings so the recorded values stay stable and searchable. The interceptor
 * resolves the target type from the route prefix via {@link resolveTargetTypeFromRoute}.
 */
export const AuditTargetType = {
  ROLE: 'role',
  USER: 'user',
  AUTH: 'auth',
  DEVICE: 'device',
  DEVICE_GROUP: 'device_group',
  STRATEGY: 'strategy',
  ADDRESS_BOOK: 'address_book',
  SETTINGS: 'settings',
  OIDC: 'oidc',
  PASSKEY: 'passkey',
  ROUTE: 'route',
} as const;
export type AuditTargetType =
  (typeof AuditTargetType)[keyof typeof AuditTargetType];

/**
 * Canonical audit actions for the explicitly instrumented sites. Persisted in
 * `console_audits.action`.
 *
 * The global {@link ConsoleAuditInterceptor} cannot infer business-level verbs
 * (create vs. disconnect for POST), so it records a normalized
 * `<METHOD> <route>` form instead. Both forms coexist; consumers should treat
 * `action` as a free-form string and filter by prefix where needed.
 */
export const AuditAction = {
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',
  USER_ROLE_REPLACE: 'user_role.replace',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_OIDC_LOGIN: 'auth.oidc_login',
  AUTH_PASSKEY_LOGIN: 'auth.passkey_login',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResult = {
  ALLOWED: 'allowed',
  DENIED: 'denied',
} as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];

/**
 * Maps the first path segment of a request URL (e.g. `roles`, `device-groups`)
 * to a canonical {@link AuditTargetType}. Unmapped segments fall back to the
 * raw lower-cased value, or {@link AuditTargetType.ROUTE} when empty.
 */
const ROUTE_TARGET_TYPE_MAP: Record<string, AuditTargetType> = {
  roles: AuditTargetType.ROLE,
  users: AuditTargetType.USER,
  auth: AuditTargetType.AUTH,
  devices: AuditTargetType.DEVICE,
  'device-groups': AuditTargetType.DEVICE_GROUP,
  strategies: AuditTargetType.STRATEGY,
  'address-books': AuditTargetType.ADDRESS_BOOK,
  settings: AuditTargetType.SETTINGS,
  'oidc-providers': AuditTargetType.OIDC,
  passkeys: AuditTargetType.PASSKEY,
};

export function resolveTargetTypeFromRoute(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return AuditTargetType.ROUTE;
  return ROUTE_TARGET_TYPE_MAP[key] ?? key;
}

/**
 * Builds a normalized `<METHOD> <path>` action for interceptor-recorded
 * operations. The `/api` prefix is stripped and the route template
 * (e.g. `/roles/:guid`) is preserved so identical operations share a value.
 */
export function buildRouteAction(
  method: string,
  baseUrl: string,
  routePath: string,
): string {
  const full = `${baseUrl}${routePath}`.replace(/^\/api\/?/, '/');
  return `${method.toUpperCase()} ${full || '/'}`;
}