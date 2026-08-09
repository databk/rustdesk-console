import * as path from 'path';

const DEFAULT_DATA_DIR = './data';
const DB_FILENAME = 'rustdesk-console.db';
const NEXUS_BUILD_SUBDIR = 'nexus-builds';

/**
 * Get the unified data directory.
 * Controlled by the DATA_DIR env var (default: ./data).
 */
export function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

/**
 * Get the SQLite database file path.
 * Uses DB_PATH env var if set (backward compatibility),
 * otherwise derives it from DATA_DIR.
 */
export function getDbPath(): string {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  return path.join(getDataDir(), DB_FILENAME);
}

/**
 * Get the Nexus build artifact storage directory.
 * Uses NEXUS_STORAGE_PATH env var if set (backward compatibility),
 * otherwise derives it from DATA_DIR.
 */
export function getNexusStoragePath(): string {
  if (process.env.NEXUS_STORAGE_PATH) {
    return process.env.NEXUS_STORAGE_PATH;
  }
  return path.join(getDataDir(), NEXUS_BUILD_SUBDIR);
}
