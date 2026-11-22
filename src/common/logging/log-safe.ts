const DEFAULT_MAX_LENGTH = 64;

// Control characters plus the Unicode line and paragraph separators.
const UNSAFE_CHARACTERS = /\p{Cc}|\p{Zl}|\p{Zp}/gu;

/**
 * Makes a client-supplied value safe to embed in a log line: control
 * characters (including line breaks) are replaced so one request cannot
 * forge extra log lines, and long values are truncated.
 * Usage: `this.logger.warn(`Login failed: unknown user ${logSafe(username)}`);`
 */
export function logSafe(
  value: unknown,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  const text = String(value).replace(UNSAFE_CHARACTERS, '?');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
