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
    // JSON.stringify returns undefined for undefined, functions and symbols,
    // and throws on circular structures and BigInt.
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
