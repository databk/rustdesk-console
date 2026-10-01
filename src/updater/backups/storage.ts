import { createHash } from 'node:crypto';
import { constants, createReadStream, promises as fs } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { BackupContext, BackupSnapshot } from '../contracts';
import { assert, UpdateError } from '../errors';
import { atomicWrite, digest, missing, syncDirectory } from '../io';

export interface FileEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  sha256?: string;
  mode: number;
  uid: number;
  gid: number;
}
export interface SnapshotManifest {
  format: 1;
  jobId: string;
  database: 'sqlite' | 'mysql';
  binding: string;
  createdAt: string;
  databaseFile: string;
  databaseSize: number;
  databaseSha256: string;
  files: FileEntry[];
  details: Record<string, unknown>;
}
const HASH = /^[0-9a-f]{64}$/;
const MAX_FILES = 100_000;
function containsControl(value: string): boolean {
  return Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
}

export function requireStopped(context: BackupContext): void {
  assert(
    context.servicesStopped === true,
    'BACKUP_MAINTENANCE_REQUIRED',
    'All application writers must be stopped before backup or restore.',
  );
}
export function contained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === '' ||
    (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  );
}
export function binding(context: BackupContext): string {
  const db = context.database;
  return digest({
    dataDir: resolve(context.dataDir),
    database:
      db.kind === 'sqlite'
        ? { kind: db.kind, path: resolve(db.path) }
        : {
            kind: db.kind,
            host: db.host,
            port: db.port,
            database: db.database,
          },
  });
}
export async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== absolute) await noLinks(parent);
  const info = await fs.lstat(absolute);
  assert(
    !info.isSymbolicLink(),
    'BACKUP_UNSAFE_PATH',
    'Backup paths cannot contain symbolic links.',
  );
}
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}
export async function privateDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  await noLinks(path);
  const info = await fs.stat(path);
  assert(
    info.isDirectory(),
    'BACKUP_UNSAFE_PATH',
    'A backup directory is invalid.',
  );
  if (process.platform !== 'win32') {
    assert(
      (info.mode & 0o077) === 0,
      'BACKUP_PERMISSIONS',
      'Private backup directories must not be accessible to other users.',
    );
  }
}
export async function assertContext(context: BackupContext): Promise<void> {
  assert(
    /^[a-zA-Z0-9_-]{1,128}$/.test(context.jobId),
    'BACKUP_INVALID_CONTEXT',
    'The backup job identity is invalid.',
  );
  assert(
    isAbsolute(context.dataDir) && isAbsolute(context.backupDir),
    'BACKUP_UNSAFE_PATH',
    'Backup and data paths must be absolute.',
  );
  assert(
    !contained(context.dataDir, context.backupDir) &&
      !contained(context.backupDir, context.dataDir),
    'BACKUP_UNSAFE_PATH',
    'Updater backups must be outside the business data directory.',
  );
  await noLinks(context.dataDir);
  assert(
    (await fs.stat(context.dataDir)).isDirectory(),
    'BACKUP_UNSAFE_PATH',
    'The business data directory is invalid.',
  );
  await privateDirectory(context.backupDir);
}
export async function scanFiles(
  root: string,
  excluded: Set<string> = new Set(),
  hashes = true,
): Promise<FileEntry[]> {
  await noLinks(root);
  const files: FileEntry[] = [];
  async function visit(directory: string) {
    const names = (await fs.readdir(directory)).sort();
    for (const name of names) {
      const path = join(directory, name);
      if (excluded.has(resolve(path))) continue;
      const info = await fs.lstat(path);
      assert(
        info.isDirectory() || (info.isFile() && info.nlink === 1),
        'BACKUP_UNSAFE_FILE',
        'Business data contains a symbolic link, hard link, or unsupported file type.',
      );
      const entry: FileEntry = {
        path: relative(root, path).split(sep).join('/'),
        kind: info.isDirectory() ? 'directory' : 'file',
        size: info.isFile() ? info.size : 0,
        mode: info.mode & 0o777,
        uid: info.uid,
        gid: info.gid,
      };
      assert(
        !entry.path.includes('\\') && !containsControl(entry.path),
        'BACKUP_UNSAFE_FILE',
        'Business data contains an unsupported file name.',
      );
      if (entry.kind === 'file' && hashes) entry.sha256 = await hashFile(path);
      files.push(entry);
      assert(
        files.length <= MAX_FILES,
        'BACKUP_FILE_LIMIT',
        'Business data exceeds the supported snapshot file limit.',
      );
      if (entry.kind === 'directory') await visit(path);
    }
  }
  await visit(root);
  return files;
}
export async function checkSpace(
  context: BackupContext,
  databaseBytes: number,
  excluded?: Set<string>,
): Promise<void> {
  const entries = await scanFiles(context.dataDir, excluded, false);
  const bytes =
    entries.reduce((sum, item) => sum + item.size, 0) + databaseBytes;
  for (const directory of [context.backupDir, context.dataDir]) {
    const space = await fs.statfs(directory);
    assert(
      space.bavail * space.bsize >= bytes * 3 + 64 * 1024 * 1024,
      'BACKUP_INSUFFICIENT_SPACE',
      'There is insufficient disk space for backup and recoverable restoration.',
    );
  }
}
export async function durableCopy(
  source: string,
  destination: string,
): Promise<void> {
  await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  await fs.chmod(destination, 0o600);
  const file = await fs.open(destination, 'r+');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function copyFiles(
  source: string,
  destination: string,
  entries: FileEntry[],
): Promise<void> {
  await fs.mkdir(destination, { mode: 0o700 });
  for (const entry of entries) {
    const target = join(destination, entry.path);
    if (entry.kind === 'directory') await fs.mkdir(target, { mode: 0o700 });
    else await durableCopy(join(source, entry.path), target);
  }
  for (const entry of [...entries].reverse()) {
    if (entry.kind === 'directory')
      await syncDirectory(join(destination, entry.path));
  }
  await syncDirectory(destination);
}
export async function verifyFiles(
  directory: string,
  expected: FileEntry[],
): Promise<void> {
  const actual = await scanFiles(directory);
  assert(
    actual.length === expected.length,
    'BACKUP_FILES_MISMATCH',
    'The business file snapshot is incomplete.',
  );
  const key = (entry: FileEntry) => [
    entry.path,
    entry.kind,
    entry.size,
    entry.sha256,
  ];
  assert(
    JSON.stringify(actual.map(key)) === JSON.stringify(expected.map(key)),
    'BACKUP_FILES_MISMATCH',
    'The business file snapshot failed integrity verification.',
  );
}
export async function beginSnapshot(context: BackupContext): Promise<string> {
  requireStopped(context);
  await assertContext(context);
  try {
    await fs.lstat(join(context.backupDir, 'snapshot'));
    throw new UpdateError(
      'BACKUP_ALREADY_EXISTS',
      'An immutable snapshot already exists for this job.',
    );
  } catch (error) {
    if (!missing(error)) throw error;
  }
  return fs.mkdtemp(join(context.backupDir, '.snapshot-'));
}
export async function completeSnapshot(
  context: BackupContext,
  staging: string,
  databaseFile: string,
  files: FileEntry[],
  details: Record<string, unknown>,
): Promise<BackupSnapshot> {
  const db = join(staging, databaseFile);
  const manifest: SnapshotManifest = {
    format: 1,
    jobId: context.jobId,
    database: context.database.kind,
    binding: binding(context),
    createdAt: new Date().toISOString(),
    databaseFile,
    databaseSize: (await fs.stat(db)).size,
    databaseSha256: await hashFile(db),
    files,
    details,
  };
  await verifyFiles(join(staging, 'files'), files);
  await atomicWrite(join(staging, 'snapshot.json'), manifest);
  const path = join(context.backupDir, 'snapshot');
  await fs.rename(staging, path);
  await syncDirectory(context.backupDir);
  return {
    schemaVersion: 1,
    jobId: context.jobId,
    database: context.database.kind,
    path,
    createdAt: manifest.createdAt,
    metadata: { manifestSha256: await hashFile(join(path, 'snapshot.json')) },
  };
}
function validEntry(value: unknown): value is FileEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as FileEntry;
  return (
    typeof entry.path === 'string' &&
    entry.path.length > 0 &&
    !entry.path.startsWith('/') &&
    !entry.path.includes('\\') &&
    !entry.path.includes(':') &&
    !containsControl(entry.path) &&
    entry.path
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..') &&
    ['file', 'directory'].includes(entry.kind) &&
    Number.isSafeInteger(entry.size) &&
    entry.size >= 0 &&
    Number.isSafeInteger(entry.mode) &&
    entry.mode >= 0 &&
    entry.mode <= 0o777 &&
    Number.isSafeInteger(entry.uid) &&
    entry.uid >= 0 &&
    Number.isSafeInteger(entry.gid) &&
    entry.gid >= 0 &&
    (entry.kind === 'directory' ||
      (typeof entry.sha256 === 'string' && HASH.test(entry.sha256)))
  );
}
export async function readSnapshot(
  context: BackupContext,
  snapshot: BackupSnapshot,
): Promise<SnapshotManifest> {
  await assertContext(context);
  assert(
    snapshot.schemaVersion === 1 &&
      snapshot.jobId === context.jobId &&
      snapshot.database === context.database.kind &&
      resolve(snapshot.path) === join(resolve(context.backupDir), 'snapshot'),
    'BACKUP_SNAPSHOT_MISMATCH',
    'The backup snapshot does not belong to this job.',
  );
  await noLinks(snapshot.path);
  const manifestPath = join(snapshot.path, 'snapshot.json');
  await noLinks(manifestPath);
  assert(
    (await fs.stat(manifestPath)).size <= 32 * 1024 * 1024,
    'BACKUP_MANIFEST_INVALID',
    'The backup manifest is too large.',
  );
  assert(
    (await hashFile(manifestPath)) === snapshot.metadata.manifestSha256,
    'BACKUP_MANIFEST_INVALID',
    'The backup manifest failed integrity verification.',
  );
  const manifest = JSON.parse(
    await fs.readFile(manifestPath, 'utf8'),
  ) as SnapshotManifest;
  assert(
    manifest.format === 1 &&
      manifest.jobId === context.jobId &&
      manifest.database === context.database.kind &&
      manifest.binding === binding(context) &&
      manifest.databaseFile ===
        (context.database.kind === 'sqlite'
          ? 'database.sqlite'
          : 'database.sql') &&
      typeof manifest.databaseSha256 === 'string' &&
      HASH.test(manifest.databaseSha256) &&
      Array.isArray(manifest.files) &&
      manifest.files.length <= MAX_FILES &&
      manifest.files.every(validEntry),
    'BACKUP_MANIFEST_INVALID',
    'The backup manifest is invalid for this installation.',
  );
  assert(
    new Set(manifest.files.map((entry) => entry.path)).size ===
      manifest.files.length,
    'BACKUP_MANIFEST_INVALID',
    'The backup manifest contains duplicate paths.',
  );
  const database = join(snapshot.path, manifest.databaseFile);
  await noLinks(database);
  const info = await fs.stat(database);
  assert(
    info.isFile() &&
      info.size === manifest.databaseSize &&
      (await hashFile(database)) === manifest.databaseSha256,
    'BACKUP_DATABASE_INVALID',
    'The database snapshot failed integrity verification.',
  );
  await verifyFiles(join(snapshot.path, 'files'), manifest.files);
  return manifest;
}
export async function restoreFiles(
  context: BackupContext,
  snapshot: BackupSnapshot,
  manifest: SnapshotManifest,
  excluded: Set<string> = new Set(),
): Promise<void> {
  requireStopped(context);
  // 先完整验证，再保留失败现场；不覆盖/删除原恢复材料。
  await verifyFiles(join(snapshot.path, 'files'), manifest.files);
  const current = await scanFiles(context.dataDir, excluded, false);
  const quarantine = await fs.mkdtemp(
    join(context.backupDir, 'displaced-files-'),
  );
  const retainedRoot = join(quarantine, 'files');
  await fs.mkdir(retainedRoot, { mode: 0o700 });
  await atomicWrite(join(quarantine, 'intent.json'), {
    jobId: context.jobId,
    files: current.map((file) => file.path),
  });
  for (const entry of current.filter((entry) => !entry.path.includes('/'))) {
    const source = join(context.dataDir, entry.path);
    const destination = join(retainedRoot, entry.path);
    // 备份与业务卷可能不在同一文件系统；保留副本后再移走该业务子树。
    await fs.cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    const retained = await scanFiles(retainedRoot);
    for (const item of retained.filter((item) => item.kind === 'file')) {
      const handle = await fs.open(join(retainedRoot, item.path), 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    for (const item of [...retained].reverse()) {
      if (item.kind === 'directory')
        await syncDirectory(join(retainedRoot, item.path));
    }
    await syncDirectory(retainedRoot);
    await syncDirectory(quarantine);
    await fs.rm(source, { recursive: true });
  }
  for (const entry of manifest.files) {
    const target = join(context.dataDir, entry.path);
    if (entry.kind === 'directory') await fs.mkdir(target, { mode: 0o700 });
    else await durableCopy(join(snapshot.path, 'files', entry.path), target);
  }
  for (const entry of [...manifest.files].reverse()) {
    const target = join(context.dataDir, entry.path);
    if (process.platform !== 'win32')
      await fs.chown(target, entry.uid, entry.gid);
    await fs.chmod(target, entry.mode);
    if (entry.kind === 'directory') await syncDirectory(target);
  }
  await syncDirectory(context.dataDir);
  const restored = await scanFiles(context.dataDir, excluded);
  assert(
    JSON.stringify(restored) === JSON.stringify(manifest.files),
    'BACKUP_RESTORE_FILES_INVALID',
    'Restored business files failed verification.',
  );
  await atomicWrite(join(quarantine, 'restored.json'), {
    jobId: context.jobId,
  });
}
export async function quarantineFile(
  source: string,
  directory: string,
): Promise<void> {
  try {
    const info = await fs.lstat(source);
    assert(
      info.isFile() && !info.isSymbolicLink(),
      'BACKUP_UNSAFE_FILE',
      'A database recovery file is unsafe.',
    );
    await durableCopy(source, join(directory, basename(source)));
    await syncDirectory(directory);
    await fs.unlink(source);
    await syncDirectory(dirname(source));
  } catch (error) {
    if (!missing(error)) throw error;
  }
}
