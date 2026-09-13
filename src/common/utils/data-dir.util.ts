import * as path from 'path';

const DEFAULT_DATA_DIR = './data';
const DB_FILENAME = 'rustdesk-console.db';
const NEXUS_BUILD_SUBDIR = 'nexus-builds';
const AVATAR_SUBDIR = 'avatars';

export type DbType = 'sqlite' | 'mysql';

/**
 * Get the unified data directory.
 * Controlled by the DATA_DIR env var (default: ./data).
 */
export function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

/**
 * Get the configured database type.
 * Controlled by the DB_TYPE env var (default: sqlite).
 * When set to 'mysql', the app connects to a MySQL server instead of using
 * the embedded SQLite file.
 */
export function getDbType(): DbType {
  const raw = process.env.DB_TYPE?.trim().toLowerCase() || 'sqlite';
  if (raw === 'sqlite' || raw === 'mysql') {
    return raw;
  }
  throw new Error(`Unsupported DB_TYPE: ${raw}`);
}

/**
 * Get the SQLite database file path.
 * Only meaningful when getDbType() === 'sqlite'.
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

/**
 * Get the avatar storage directory.
 */
export function getAvatarDir(): string {
  return path.join(getDataDir(), AVATAR_SUBDIR);
}
