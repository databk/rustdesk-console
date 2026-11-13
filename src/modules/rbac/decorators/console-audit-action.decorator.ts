import { SetMetadata } from '@nestjs/common';

export const CONSOLE_AUDIT_ACTION_KEY = 'consoleAuditAction';

/** Canonical action name: `<resource>.<verb>` (e.g. `user.create`). */
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_]*)+$/;
const ACTION_PARAM_PATTERN = /^[a-z0-9_]+$/;
const DEFAULT_TARGET_PARAMS = ['guid', 'uuid', 'id', 'jti'];
const MAX_TARGET_GUID_LENGTH = 255;

const recordedErrors = new WeakSet<object>();

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
  /** Use the request body itself as the target GUID when it is a string or number. */
  targetGuidFromBody?: boolean;
  /** Response body field that carries the target GUID (used for create operations). */
  targetGuidResponseField?: string;
  /** Use the response itself as the target GUID when it is a string or number. */
  targetGuidFromResponse?: boolean;
  /** Use the authenticated actor's user GUID as the target (e.g. self-service endpoints). */
  targetGuidActor?: boolean;
  /** Whether to store the request body as the audit after-state. Defaults to true. */
  includeBody?: boolean;
  /** Request query fields to merge into the after-state. */
  includeQueryFields?: string[];
  /** Build a custom after-state from the request and response. */
  afterState?: (request: ConsoleAuditRequest, response: unknown) => unknown;
  /** Response field indicating a business failure that should be audited as denied. */
  failureResponseField?: string;
  /** Route parameter that provides the dynamic action suffix (e.g. restart). */
  actionParam?: string;
  /** Prefix used with `actionParam`. Defaults to the declared action. */
  actionParamPrefix?: string;
}

export interface ConsoleAuditActionMetadata extends ConsoleAuditActionOptions {
  action: string;
}

export interface ConsoleAuditRequest {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
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

/** Resolves the action, expanding a validated route parameter when configured. */
export function resolveConsoleAuditAction(
  metadata: ConsoleAuditActionMetadata,
  request: ConsoleAuditRequest,
): string {
  if (!metadata.actionParam) {
    return metadata.action;
  }
  const value = request.params?.[metadata.actionParam];
  if (!value || !ACTION_PARAM_PATTERN.test(value)) {
    return metadata.action;
  }
  return `${metadata.actionParamPrefix ?? metadata.action}.${value}`;
}

/** Resolves the target type, defaulting to the action's resource segment. */
export function resolveConsoleAuditTargetType(
  metadata: ConsoleAuditActionMetadata,
): string {
  return metadata.targetType ?? metadata.action.split('.')[0];
}

/**
 * Resolves the target GUID from route parameters, the request body, or the
 * response body, bounded to the audited column width.
 */
export function resolveConsoleAuditTargetGuid(
  metadata: ConsoleAuditActionMetadata,
  request: ConsoleAuditRequest,
  response?: unknown,
): string | null {
  if (metadata.targetGuidActor) {
    return boundTargetGuid(request.user?.id);
  }

  if (metadata.targetGuidParam !== false) {
    const params = metadata.targetGuidParam
      ? [metadata.targetGuidParam]
      : DEFAULT_TARGET_PARAMS;
    for (const key of params) {
      const value = request.params?.[key];
      const guid = boundTargetGuid(value);
      if (guid) return guid;
    }
  }

  if (metadata.targetGuidBodyField) {
    const body = request.body as Record<string, unknown> | null | undefined;
    const guid = boundTargetGuid(
      singleGuidValue(body?.[metadata.targetGuidBodyField]),
    );
    if (guid) return guid;
  }

  if (metadata.targetGuidFromBody) {
    const guid = boundTargetGuid(singleGuidValue(request.body));
    if (guid) return guid;
  }

  if (metadata.targetGuidResponseField) {
    const body = response as Record<string, unknown> | null | undefined;
    const guid = boundTargetGuid(
      singleGuidValue(body?.[metadata.targetGuidResponseField]),
    );
    if (guid) return guid;
  }

  if (metadata.targetGuidFromResponse) {
    const guid = boundTargetGuid(singleGuidValue(response));
    if (guid) return guid;
  }

  return null;
}

/** Marks an error whose denial has already been written to the audit log. */
export function markConsoleAuditRecorded(error: unknown): void {
  if (isObject(error)) {
    recordedErrors.add(error);
  }
}

/** Returns true when a denial for this error was already recorded. */
export function isConsoleAuditRecorded(error: unknown): boolean {
  return isObject(error) && recordedErrors.has(error);
}

/** Extracts one GUID from a string, number, or single-element array. */
function singleGuidValue(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.length === 1) {
    const [first] = value as unknown[];
    if (typeof first === 'string' && first !== '') return first;
    if (typeof first === 'number') return String(first);
  }
  return null;
}

/** Drops GUIDs that do not fit the audited varchar column. */
function boundTargetGuid(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!value || value.length > MAX_TARGET_GUID_LENGTH) return null;
  return value;
}

/** Narrows values that can participate in the denial WeakSet. */
function isObject(value: unknown): value is object {
  return (
    value !== null && (typeof value === 'object' || typeof value === 'function')
  );
}
