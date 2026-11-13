import type { LogLevel } from '@nestjs/common';

/** Nest log levels ordered from the most to the least verbose. */
const LOG_LEVEL_ORDER: readonly LogLevel[] = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
];

const DEFAULT_LOG_LEVEL: LogLevel = 'log';

/**
 * Resolves the list of Nest log levels to enable from the `LOG_LEVEL`
 * environment variable. The value is the minimum level to print, so
 * `LOG_LEVEL=warn` enables `warn`, `error` and `fatal`.
 *
 * Accepted values (case-insensitive): `verbose`, `debug`, `log`, `info`
 * (alias of `log`), `warn`, `error` and `fatal`. Unset, empty or unknown
 * values fall back to `log`.
 *
 * @param value raw `LOG_LEVEL` value
 * @returns the enabled log levels, most verbose first
 */
export function resolveLogLevels(value?: string): LogLevel[] {
  const requested = (value ?? '').trim().toLowerCase();
  const level = requested === 'info' ? 'log' : requested;
  const index = LOG_LEVEL_ORDER.indexOf(level as LogLevel);
  return LOG_LEVEL_ORDER.slice(
    index >= 0 ? index : LOG_LEVEL_ORDER.indexOf(DEFAULT_LOG_LEVEL),
  );
}

/**
 * Returns true when `value` is unset/empty or a recognised `LOG_LEVEL`.
 */
export function isValidLogLevel(value?: string): boolean {
  const requested = (value ?? '').trim().toLowerCase();
  return (
    requested === '' ||
    requested === 'info' ||
    LOG_LEVEL_ORDER.includes(requested as LogLevel)
  );
}
