import { SetMetadata } from '@nestjs/common';

export const CONSOLE_AUDIT_ACTION_KEY = 'consoleAuditAction';

/** Canonical action name: `<resource>.<verb>` (e.g. `user.create`). */
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_]*)+$/;
const DEFAULT_TARGET_PARAMS = ['guid', 'uuid', 'id', 'jti'];

export interface ConsoleAuditActionOptions {
  /** Target resource type. Defaults to the first segment of the action. */
  targetType?: string;
  /**
   * Request path parameter that carries the target GUID.
   * Defaults to `guid`, `uuid`, `id`, then `jti`.
   * Set to `false` when the operation has no single target GUID.
   */
  targetGuidParam?: string | false;
  /** Request body field that carries the target GUID (used when no path parameter matches). */
  targetGuidBodyField?: string;
  /** Use the authenticated actor's user GUID as the target (e.g. self-service endpoints). */
  targetGuidActor?: boolean;
  /** Whether to store the request body as the audit after-state. Defaults to true. */
  includeBody?: boolean;
}

export interface ConsoleAuditActionMetadata extends ConsoleAuditActionOptions {
  action: string;
}

export interface ConsoleAuditRequest {
  params?: Record<string, string>;
  body?: unknown;
  user?: { id?: string };
}

/**
 * Declares the canonical console audit action for a mutation endpoint.
 *
 * Action names follow `<resource>.<verb>` so audit records stay stable even if
 * HTTP routes change. Only endpoints decorated with this decorator are audited;
 * read-only endpoints implemented with POST (for legacy client compatibility)
 * therefore stay out of the console audit log.
 */
export const ConsoleAuditAction = (
  action: string,
  options: ConsoleAuditActionOptions = {},
) => {
  if (!ACTION_PATTERN.test(action)) {
    throw new Error(
      `Invalid console audit action "${action}". Expected <resource>.<verb> using lowercase letters, digits, and underscores.`,
    );
  }
  return SetMetadata<string, ConsoleAuditActionMetadata>(
    CONSOLE_AUDIT_ACTION_KEY,
    {
      action,
      ...options,
    },
  );
};

/** Resolves the target type, defaulting to the action's resource segment. */
export function resolveConsoleAuditTargetType(
  metadata: ConsoleAuditActionMetadata,
): string {
  return metadata.targetType ?? metadata.action.split('.')[0];
}

/** Resolves the target GUID from route parameters or the configured body field. */
export function resolveConsoleAuditTargetGuid(
  metadata: ConsoleAuditActionMetadata,
  request: ConsoleAuditRequest,
): string | null {
  if (metadata.targetGuidActor) {
    return request.user?.id ?? null;
  }

  if (metadata.targetGuidParam !== false) {
    const params = metadata.targetGuidParam
      ? [metadata.targetGuidParam]
      : DEFAULT_TARGET_PARAMS;
    for (const key of params) {
      const value = request.params?.[key];
      if (value !== undefined && value !== null && value !== '') {
        return String(value);
      }
    }
  }

  if (metadata.targetGuidBodyField) {
    const body = request.body as Record<string, unknown> | null | undefined;
    const value = body?.[metadata.targetGuidBodyField];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (Array.isArray(value) && value.length === 1) {
      const first: unknown = (value as unknown[])[0];
      if (typeof first === 'string' || typeof first === 'number') {
        return String(first);
      }
    }
  }

  return null;
}
