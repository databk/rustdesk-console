/**
 * Formats a caught value for the `stack` argument of `logger.error`.
 * Usage: `this.logger.error('Something failed', errorTrace(error));`
 * Never throws, so it is safe inside a catch block.
 */
export function errorTrace(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    try {
      return String(error);
    } catch {
      return '[unserializable error]';
    }
  }
}
