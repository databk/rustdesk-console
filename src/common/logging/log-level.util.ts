import type { LogLevel } from '@nestjs/common';

/** Nest log levels ordered from most to least verbose. */
const LOG_LEVEL_ORDER: readonly LogLevel[] = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
];

const ALIASES: Record<string, LogLevel> = {
  info: 'log',
  warning: 'warn',
  trace: 'verbose',
};

export const DEFAULT_LOG_LEVEL: LogLevel = 'log';

/**
 * Resolve the LOG_LEVEL setting into the list of levels Nest should print.
 * The value is a minimum threshold: `log` (alias `info`) prints log, warn,
 * error and fatal. Unknown or empty values fall back to the default.
 */
export function resolveLogLevels(value: string | undefined): LogLevel[] {
  const normalised = value?.trim().toLowerCase() ?? '';
  const level = ALIASES[normalised] ?? normalised;
  const index = (LOG_LEVEL_ORDER as readonly string[]).indexOf(level);
  const start = index >= 0 ? index : LOG_LEVEL_ORDER.indexOf(DEFAULT_LOG_LEVEL);
  return LOG_LEVEL_ORDER.slice(start);
}
