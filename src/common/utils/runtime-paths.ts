import * as path from 'path';

let seaMode: boolean | null = null;

interface SeaModule {
  isSea(): boolean;
}

/**
 * Check if the application is running as a Single Executable Application (SEA).
 */
export function isSea(): boolean {
  if (seaMode !== null) return seaMode;

  let result = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require('node:sea') as SeaModule;
    result = sea.isSea();
  } catch {
    result = false;
  }
  seaMode = result;
  return result;
}

/**
 * Get the base directory for resolving runtime assets.
 * - SEA or private Node bundle: directory of the executable
 * - Normal mode: directory of the calling module
 */
export function getRuntimeDir(moduleDir: string): string {
  if (isSea() || process.env.CONSOLE_RUNTIME_BUNDLE === '1') {
    return path.dirname(process.execPath);
  }
  return moduleDir;
}

/**
 * Resolve an asset path relative to the runtime base directory.
 *
 * @param moduleDir - __dirname of the calling module (used in normal mode)
 * @param relativePath - path relative to moduleDir (used in normal mode)
 * @param bundlePath - path relative to the executable directory in packaged builds
 */
export function resolveAssetPath(
  moduleDir: string,
  relativePath: string,
  bundlePath: string,
): string {
  if (isSea() || process.env.CONSOLE_RUNTIME_BUNDLE === '1') {
    return path.join(path.dirname(process.execPath), bundlePath);
  }
  return path.join(moduleDir, relativePath);
}
