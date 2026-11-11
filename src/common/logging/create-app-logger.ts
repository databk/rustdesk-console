import { ConsoleLogger } from '@nestjs/common';
import { resolveLogLevels } from './log-level.util';

/**
 * Builds the application-wide logger from the environment.
 * Modules keep using `new Logger(Class.name)`; this only decides what is
 * printed and how.
 */
export function createAppLogger(env: NodeJS.ProcessEnv = process.env) {
  return new ConsoleLogger({
    logLevels: resolveLogLevels(env.LOG_LEVEL),
    colors: Boolean(process.stdout.isTTY) && !env.NO_COLOR,
  });
}
