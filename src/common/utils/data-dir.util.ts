import * as path from 'path';

const DEFAULT_DATA_DIR = './data';
const DB_FILENAME = 'rustdesk-console.db';
const CUSTOM_CLIENT_BUILD_SUBDIR = 'custom-client-builds';
const CUSTOM_CLIENT_LOGO_SUBDIR = 'custom-client-logos';
const AVATAR_SUBDIR = 'avatars';

export type DbType = 'sqlite' | 'mysql';

export function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

export function getDbType(): DbType {
  const raw = process.env.DB_TYPE?.trim().toLowerCase() || 'sqlite';
  if (raw === 'sqlite' || raw === 'mysql') {
    return raw;
  }
  throw new Error(`Unsupported DB_TYPE: ${raw}`);
}

export function getDbPath(): string {
  return path.join(getDataDir(), DB_FILENAME);
}

export function getCustomClientStoragePath(): string {
  return path.join(getDataDir(), CUSTOM_CLIENT_BUILD_SUBDIR);
}

export function getCustomClientLogoPath(): string {
  return path.join(getDataDir(), CUSTOM_CLIENT_LOGO_SUBDIR);
}

export function getAvatarDir(): string {
  return path.join(getDataDir(), AVATAR_SUBDIR);
}
