import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  BackupAdapter,
  BackupContext,
  BackupSnapshot,
  Blocker,
} from '../contracts';
import { assert, safeError, UpdateError } from '../errors';
import { syncDirectory } from '../io';
import { runBackupCommand, type BackupCommandRunner } from './process';
import {
  assertContext,
  beginSnapshot,
  checkSpace,
  completeSnapshot,
  copyFiles,
  durableCopy,
  noLinks,
  quarantineFile,
  readSnapshot,
  requireStopped,
  restoreFiles,
  scanFiles,
} from './storage';

export class SqliteBackupAdapter implements BackupAdapter {
  constructor(private readonly run: BackupCommandRunner = runBackupCommand) {}

  private database(context: BackupContext): string {
    assert(
      context.database.kind === 'sqlite',
      'BACKUP_DATABASE_MISMATCH',
      'The backup adapter does not match the configured database.',
    );
    const path = resolve(context.database.path);
    assert(
      dirname(path) === resolve(context.dataDir),
      'BACKUP_UNSAFE_PATH',
      'The SQLite database must be directly inside the managed data directory.',
    );
    return path;
  }
  private excluded(context: BackupContext): Set<string> {
    const path = this.database(context);
    return new Set([path, `${path}-wal`, `${path}-shm`, `${path}-journal`]);
  }
  private async integrity(path: string): Promise<void> {
    const result = await this.run({
      executable: 'sqlite3',
      args: ['-batch', '-bail', '-readonly', path],
      input: '.timeout 5000\nPRAGMA integrity_check;\n',
    });
    assert(
      result.trim() === 'ok',
      'SQLITE_INTEGRITY_FAILED',
      'The SQLite database failed integrity verification.',
    );
  }
  async preflight(context: BackupContext): Promise<Blocker[]> {
    try {
      await assertContext(context);
      const path = this.database(context);
      await noLinks(path);
      const info = await fs.stat(path);
      assert(
        info.isFile() && info.nlink === 1,
        'BACKUP_UNSAFE_FILE',
        'The SQLite database is not a regular private file.',
      );
      const version = await this.run({
        executable: 'sqlite3',
        args: ['-version'],
      });
      assert(
        /^3\.(?:[3-9][0-9]|[1-9][0-9]{2,})\./.test(version),
        'SQLITE_CLIENT_UNSUPPORTED',
        'SQLite 3.30 or later is required for managed backups.',
      );
      await this.integrity(path);
      await checkSpace(
        context,
        info.size +
          (await fs.stat(`${path}-wal`).catch(() => ({ size: 0 }))).size,
        this.excluded(context),
      );
      return [];
    } catch (error) {
      return [safeError(error).blocker()];
    }
  }
  async backup(context: BackupContext): Promise<BackupSnapshot> {
    requireStopped(context);
    const blockers = await this.preflight(context);
    if (blockers.length)
      throw new UpdateError(blockers[0].code, blockers[0].message);
    const path = this.database(context);
    const info = await fs.stat(path);
    const staging = await beginSnapshot(context);
    // 固定 cwd 和固定 .backup 文件名，避免 shell 或 SQLite dot-command 路径插值。
    await this.run({
      executable: 'sqlite3',
      args: ['-batch', '-bail', '-readonly', path],
      cwd: staging,
      input: '.timeout 5000\n.backup database.sqlite\n',
      timeoutMs: 30 * 60_000,
    });
    const backup = join(staging, 'database.sqlite');
    await fs.chmod(backup, 0o600);
    const handle = await fs.open(backup, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.integrity(backup);
    const files = await scanFiles(context.dataDir, this.excluded(context));
    await copyFiles(context.dataDir, join(staging, 'files'), files);
    assert(
      JSON.stringify(
        await scanFiles(context.dataDir, this.excluded(context)),
      ) === JSON.stringify(files),
      'BACKUP_CONCURRENT_WRITE',
      'Business files changed while the application was stopped.',
    );
    return completeSnapshot(context, staging, 'database.sqlite', files, {
      method: 'sqlite-backup-api',
      mode: info.mode & 0o777,
      uid: info.uid,
      gid: info.gid,
    });
  }
  async validate(
    context: BackupContext,
    snapshot: BackupSnapshot,
  ): Promise<void> {
    const manifest = await readSnapshot(context, snapshot);
    await this.integrity(join(snapshot.path, manifest.databaseFile));
  }
  async restore(
    context: BackupContext,
    snapshot: BackupSnapshot,
  ): Promise<void> {
    requireStopped(context);
    await this.validate(context, snapshot);
    const manifest = await readSnapshot(context, snapshot);
    const path = this.database(context);
    const { mode, uid, gid } = manifest.details;
    assert(
      typeof mode === 'number' &&
        Number.isInteger(mode) &&
        mode >= 0 &&
        mode <= 0o777 &&
        typeof uid === 'number' &&
        Number.isInteger(uid) &&
        uid >= 0 &&
        typeof gid === 'number' &&
        Number.isInteger(gid) &&
        gid >= 0,
      'BACKUP_MANIFEST_INVALID',
      'The SQLite snapshot ownership metadata is invalid.',
    );
    await checkSpace(context, manifest.databaseSize, this.excluded(context));
    const quarantine = await fs.mkdtemp(
      join(context.backupDir, 'displaced-sqlite-'),
    );
    // 隔离新主库和所有 sidecar；否则旧快照可能被新 WAL 覆盖。
    for (const source of this.excluded(context))
      await quarantineFile(source, quarantine);
    await restoreFiles(context, snapshot, manifest, this.excluded(context));
    await durableCopy(join(snapshot.path, manifest.databaseFile), path);
    if (process.platform !== 'win32') await fs.chown(path, uid, gid);
    await fs.chmod(path, mode);
    await syncDirectory(context.dataDir);
    await this.integrity(path);
  }
}
