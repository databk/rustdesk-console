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
 */
export function getDbPath(): string {
  return path.join(getDataDir(), DB_FILENAME);
}

/**
 * Get the Nexus build artifact storage directory.
 */
export function getNexusStoragePath(): string {
  return path.join(getDataDir(), NEXUS_BUILD_SUBDIR);
}
