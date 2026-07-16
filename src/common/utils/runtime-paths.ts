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
 * - SEA mode: directory of the executable
 * - Normal mode: directory of the calling module
 */
export function getRuntimeDir(moduleDir: string): string {
  if (isSea()) {
    return path.dirname(process.execPath);
  }
  return moduleDir;
}

/**
 * Resolve an asset path relative to the runtime base directory.
 *
 * @param moduleDir - __dirname of the calling module (used in normal mode)
 * @param relativePath - path relative to moduleDir (used in normal mode)
 * @param seaPath - path relative to the executable directory (used in SEA mode)
 */
export function resolveAssetPath(
  moduleDir: string,
  relativePath: string,
  seaPath: string,
): string {
  if (isSea()) {
    return path.join(path.dirname(process.execPath), seaPath);
  }
  return path.join(moduleDir, relativePath);
}
