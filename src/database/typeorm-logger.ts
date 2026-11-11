import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';

export type DbLogMode = 'off' | 'errors' | 'queries';

export const DEFAULT_SLOW_QUERY_MS = 1000;

/**
 * DB_LOG: off | errors (default) | queries.
 * `errors` reports failed queries and TypeORM warnings; `queries` adds every
 * statement at debug level and is meant for short troubleshooting sessions.
 */
export function resolveDbLogMode(value: string | undefined): DbLogMode {
  switch (value?.trim().toLowerCase()) {
    case 'off':
    case 'false':
      return 'off';
    case 'queries':
    case 'all':
      return 'queries';
    default:
      return 'errors';
  }
}

/**
 * DB_SLOW_QUERY_MS: queries slower than this are reported as warnings.
 * Default 1000; `0` disables the check (returns undefined, which is what
 * TypeORM's `maxQueryExecutionTime` expects). Invalid values use the default.
 */
export function resolveSlowQueryMs(
  value: string | undefined,
): number | undefined {
  const text = value?.trim() ?? '';
  if (text === '') return DEFAULT_SLOW_QUERY_MS;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SLOW_QUERY_MS;
  return parsed === 0 ? undefined : parsed;
}

function collapse(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

/**
 * Driver messages can quote the offending value, for example MySQL's
 * "Duplicate entry 'alice@example.com' for key 'users.IDX_email'" or
 * "Incorrect string value: '...' for column ...". Keep the message, drop
 * the value.
 */
export function redactDriverMessage(message: string): string {
  return message.replace(/\b(entry|value:?) '.*' for /gi, "$1 '?' for ");
}

function isUniqueViolation(error: string | Error, message: string): boolean {
  const driver = (typeof error === 'object' ? error : {}) as {
    code?: unknown;
    errno?: unknown;
  };
  return (
    driver.code === 'ER_DUP_ENTRY' ||
    driver.errno === 1062 ||
    (typeof driver.code === 'string' &&
      driver.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')) ||
    /UNIQUE constraint failed|Duplicate entry/i.test(message)
  );
}

/**
 * Routes TypeORM output through the Nest logger so LOG_LEVEL applies to it.
 * Query parameters are never logged: they can hold password hashes, tokens
 * and personal data.
 */
export class TypeOrmNestLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('Database');

  constructor(private readonly mode: DbLogMode) {}

  logQuery(query: string): void {
    if (this.mode === 'queries') {
      this.logger.debug(collapse(query));
    }
  }

  logQueryError(error: string | Error, query: string): void {
    if (this.mode === 'off') return;
    const raw = error instanceof Error ? error.message : error;
    const line = `Query failed: ${redactDriverMessage(raw)} | ${collapse(query)}`;
    // Unique conflicts are part of normal operation (callers turn them into
    // a 409 or retry), so they are debug. Other failures are warnings;
    // callers and Nest's exception handler log real failures as errors.
    if (isUniqueViolation(error, raw)) {
      this.logger.debug(line);
    } else {
      this.logger.warn(line);
    }
  }

  logQuerySlow(time: number, query: string): void {
    if (this.mode === 'off') return;
    this.logger.warn(`Slow query (${time}ms): ${collapse(query)}`);
  }

  logSchemaBuild(message: string): void {
    if (this.mode === 'queries') {
      this.logger.debug(message);
    }
  }

  logMigration(message: string): void {
    if (this.mode === 'off') return;
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (this.mode === 'off') return;
    const text = String(message);
    if (level === 'warn') {
      this.logger.warn(text);
    } else {
      this.logger.debug(text);
    }
  }
}
