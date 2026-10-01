import type { Blocker } from './contracts';
export class UpdateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
  blocker(): Blocker {
    return { code: this.code, message: this.message };
  }
}
export class JournalError extends UpdateError {
  constructor() {
    super(
      'JOURNAL_UNAVAILABLE',
      'The durable task journal could not be written. Keep the maintenance fence and recover from the host.',
      503,
    );
  }
}
export function safeError(error: unknown): UpdateError {
  return error instanceof UpdateError
    ? error
    : new UpdateError(
        'EXECUTION_FAILED',
        'The update operation failed. Consult the protected host recovery log.',
        503,
      );
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new UpdateError(code, message);
}
