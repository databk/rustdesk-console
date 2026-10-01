import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BackupContext, BackupSnapshot } from '../contracts';
import { SqliteBackupAdapter } from './sqlite';
import {
  assertContext,
  beginSnapshot,
  completeSnapshot,
  copyFiles,
  readSnapshot,
  restoreFiles,
  scanFiles,
} from './storage';

describe('private backup snapshot and business files', () => {
  let root: string;
  let context: BackupContext;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'console-backup-storage-test-'));
    context = {
      jobId: 'job-1',
      dataDir: join(root, 'data'),
      backupDir: join(root, 'private'),
      database: {
        kind: 'mysql',
        host: 'localhost',
        port: 3306,
        database: 'console',
        username: 'console',
        passwordFile: join(root, 'secret'),
        exclusiveSchema: true,
      },
      servicesStopped: true,
    };
    await fs.mkdir(context.dataDir, { mode: 0o700 });
    await fs.mkdir(join(context.dataDir, 'avatars'), { mode: 0o750 });
    await fs.writeFile(join(context.dataDir, 'avatars', 'a.png'), 'before', {
      mode: 0o640,
    });
    await fs.mkdir(join(context.dataDir, 'empty'), { mode: 0o750 });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  async function snapshot(): Promise<BackupSnapshot> {
    const staging = await beginSnapshot(context);
    const files = await scanFiles(context.dataDir);
    await copyFiles(context.dataDir, join(staging, 'files'), files);
    await fs.writeFile(join(staging, 'database.sql'), 'private dump', {
      mode: 0o600,
    });
    return completeSnapshot(context, staging, 'database.sql', files, {});
  }

  it('restores all files, empty directories and metadata and retains the failed state', async () => {
    const saved = await snapshot();
    const manifest = await readSnapshot(context, saved);
    await fs.writeFile(join(context.dataDir, 'avatars', 'a.png'), 'after');
    await fs.writeFile(join(context.dataDir, 'new-upload'), 'new');
    await restoreFiles(context, saved, manifest);
    expect(
      await fs.readFile(join(context.dataDir, 'avatars', 'a.png'), 'utf8'),
    ).toBe('before');
    await expect(
      fs.stat(join(context.dataDir, 'new-upload')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.stat(join(context.dataDir, 'empty'))).isDirectory()).toBe(
      true,
    );
    const displaced = (await fs.readdir(context.backupDir)).find((name) =>
      name.startsWith('displaced-files-'),
    )!;
    expect(
      await fs.readFile(
        join(context.backupDir, displaced, 'files', 'avatars', 'a.png'),
        'utf8',
      ),
    ).toBe('after');
    expect(
      await fs.readFile(
        join(context.backupDir, displaced, 'files', 'new-upload'),
        'utf8',
      ),
    ).toBe('new');
  });
  it('rejects corrupted database or native file snapshots before modifying live files', async () => {
    const saved = await snapshot();
    await fs.writeFile(join(saved.path, 'database.sql'), 'corrupt');
    await expect(readSnapshot(context, saved)).rejects.toMatchObject({
      code: 'BACKUP_DATABASE_INVALID',
    });
    expect(
      await fs.readFile(join(context.dataDir, 'avatars', 'a.png'), 'utf8'),
    ).toBe('before');
  });
  it('binds receipts to the job, database, location and manifest digest', async () => {
    const saved = await snapshot();
    await expect(
      readSnapshot({ ...context, jobId: 'wrong-job' }, saved),
    ).rejects.toMatchObject({ code: 'BACKUP_SNAPSHOT_MISMATCH' });
    await expect(
      readSnapshot(context, { ...saved, path: root }),
    ).rejects.toMatchObject({ code: 'BACKUP_SNAPSHOT_MISMATCH' });
    await fs.appendFile(join(saved.path, 'snapshot.json'), ' ');
    await expect(readSnapshot(context, saved)).rejects.toMatchObject({
      code: 'BACKUP_MANIFEST_INVALID',
    });
  });
  it('rejects nested backups and hard-linked business data', async () => {
    await expect(
      assertContext({ ...context, backupDir: join(context.dataDir, 'backup') }),
    ).rejects.toMatchObject({ code: 'BACKUP_UNSAFE_PATH' });
    await fs.link(
      join(context.dataDir, 'avatars', 'a.png'),
      join(context.dataDir, 'alias'),
    );
    await expect(scanFiles(context.dataDir)).rejects.toMatchObject({
      code: 'BACKUP_UNSAFE_FILE',
    });
  });
  it('rejects linked directories before walking or restoring outside business data', async () => {
    const outside = join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, 'sentinel'), 'untouched');
    await fs.symlink(
      outside,
      join(context.dataDir, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(scanFiles(context.dataDir)).rejects.toMatchObject({
      code: 'BACKUP_UNSAFE_FILE',
    });
    expect(await fs.readFile(join(outside, 'sentinel'), 'utf8')).toBe(
      'untouched',
    );
  });
  it('keeps business file names separate from quarantine recovery metadata', async () => {
    await fs.writeFile(join(context.dataDir, 'intent.json'), 'business-before');
    const saved = await snapshot();
    await fs.writeFile(join(context.dataDir, 'intent.json'), 'business-after');
    await restoreFiles(context, saved, await readSnapshot(context, saved));
    expect(
      await fs.readFile(join(context.dataDir, 'intent.json'), 'utf8'),
    ).toBe('business-before');
    const displaced = (await fs.readdir(context.backupDir)).find((name) =>
      name.startsWith('displaced-files-'),
    )!;
    expect(
      await fs.readFile(
        join(context.backupDir, displaced, 'files', 'intent.json'),
        'utf8',
      ),
    ).toBe('business-after');
  });
  it('refuses a second snapshot or any restore without the stopped-writer proof', async () => {
    const saved = await snapshot();
    await expect(beginSnapshot(context)).rejects.toMatchObject({
      code: 'BACKUP_ALREADY_EXISTS',
    });
    const manifest = await readSnapshot(context, saved);
    await expect(
      restoreFiles({ ...context, servicesStopped: false }, saved, manifest),
    ).rejects.toMatchObject({ code: 'BACKUP_MAINTENANCE_REQUIRED' });
    const sqlite = new SqliteBackupAdapter(jest.fn());
    await expect(
      sqlite.backup({ ...context, servicesStopped: false }),
    ).rejects.toMatchObject({ code: 'BACKUP_MAINTENANCE_REQUIRED' });
    await expect(
      sqlite.restore({ ...context, servicesStopped: false }, saved),
    ).rejects.toMatchObject({ code: 'BACKUP_MAINTENANCE_REQUIRED' });
  });
});
