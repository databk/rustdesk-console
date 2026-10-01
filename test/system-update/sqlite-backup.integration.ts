import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { BackupContext } from '../../src/updater/contracts';
import { SqliteBackupAdapter } from '../../src/updater/backups/sqlite';

const exec = promisify(execFile);

async function main(): Promise<void> {
  const root = await fs.mkdtemp('/tmp/console-system-update-test-sqlite-');
  const dataDir = join(root, 'data');
  await fs.mkdir(dataDir, { mode: 0o700 });
  const database = join(dataDir, 'console.sqlite');
  const context: BackupContext = {
    jobId: randomUUID(),
    database: { kind: 'sqlite', path: database },
    dataDir,
    backupDir: join(root, 'backups'),
    servicesStopped: true,
  };
  // os._exit leaves a real committed WAL without a live writer or checkpoint.
  await exec('python3', [
    '-c',
    [
      'import os, sqlite3, sys',
      'c=sqlite3.connect(sys.argv[1])',
      'c.execute("PRAGMA journal_mode=WAL")',
      'c.execute("PRAGMA wal_autocheckpoint=0")',
      'c.execute("CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT)")',
      'c.execute("INSERT INTO evidence VALUES (?, ?)", (1, "committed-only-in-WAL"))',
      'c.commit()',
      'os._exit(0)',
    ].join('\n'),
    database,
  ]);
  assert((await fs.stat(`${database}-wal`)).size > 0);
  await fs.mkdir(join(dataDir, 'avatars'));
  await fs.writeFile(join(dataDir, 'avatars', 'user.txt'), 'before-update', {
    mode: 0o640,
  });
  const adapter = new SqliteBackupAdapter();
  assert.deepEqual(await adapter.preflight(context), []);
  await assert.rejects(adapter.backup({ ...context, servicesStopped: false }));
  const snapshot = await adapter.backup(context);
  await adapter.validate(context, snapshot);
  const query = async (sql: string): Promise<string> =>
    (await exec('sqlite3', ['-batch', '-bail', database, sql])).stdout.trim();
  assert.equal(
    await query('SELECT value FROM evidence WHERE id=1'),
    'committed-only-in-WAL',
  );
  await query(
    "ALTER TABLE evidence ADD COLUMN introduced TEXT; INSERT INTO evidence(id,value) VALUES(2,'uncommitted-release'); CREATE TABLE added_by_upgrade(id INTEGER);",
  );
  await fs.writeFile(join(dataDir, 'avatars', 'user.txt'), 'after-update');
  await fs.writeFile(
    join(dataDir, 'new-business-file.txt'),
    'must-disappear-on-restore',
  );
  await adapter.restore(context, snapshot);
  assert.equal(await query('SELECT group_concat(id) FROM evidence'), '1');
  assert.equal(
    await query("SELECT name FROM sqlite_master WHERE name='added_by_upgrade'"),
    '',
  );
  assert.equal(
    await query("SELECT group_concat(name) FROM pragma_table_info('evidence')"),
    'id,value',
  );
  assert.equal(
    await fs.readFile(join(dataDir, 'avatars', 'user.txt'), 'utf8'),
    'before-update',
  );
  await assert.rejects(fs.stat(join(dataDir, 'new-business-file.txt')));
  assert.equal(
    (await fs.stat(join(dataDir, 'avatars', 'user.txt'))).mode & 0o777,
    0o640,
  );
  assert.equal(await query('PRAGMA integrity_check'), 'ok');
  await fs.appendFile(join(snapshot.path, 'database.sqlite'), 'corrupt');
  await assert.rejects(adapter.validate(context, snapshot));
  // A failed validation must not overwrite writes accepted after restoration.
  await query(
    "INSERT INTO evidence(id,value) VALUES(3,'after-restore-new-write')",
  );
  await assert.rejects(adapter.restore(context, snapshot));
  assert.equal(
    await query('SELECT value FROM evidence WHERE id=3'),
    'after-restore-new-write',
  );
  console.log(
    JSON.stringify({
      suite: 'sqlite-real-backup-adapter',
      root,
      passed: [
        'committed-WAL',
        'writer-stop-required',
        'schema-rollback',
        'business-files-rollback',
        'file-mode-preserved',
        'integrity',
        'corrupt-backup-rejected-before-mutation',
      ],
      scope:
        'adapter integration only; not deployment or published-release acceptance',
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Integration failed');
  process.exitCode = 1;
});
