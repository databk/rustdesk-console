import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BackupContext, DatabaseConfig } from '../contracts';
import { UpdateError } from '../errors';
import { MysqlBackupAdapter } from './mysql';
import type { BackupCommand, BackupCommandRunner } from './process';

describe('MySQL backup adapter safety and recovery contract', () => {
  let root: string;
  let context: BackupContext;
  let calls: BackupCommand[];
  let options: string[];
  let engine: string;
  let grants: string;
  let connections: string;
  let references: string;
  let triggers: string;
  let upgraded: boolean;
  let dumpFails: boolean;
  let restoreFails: boolean;
  let incomplete: boolean;
  let tlsCipher: string;
  let family: 'mysql' | 'mariadb';
  let runner: BackupCommandRunner;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'console-backup-mysql-test-'));
    const database: DatabaseConfig = {
      kind: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'console_app',
      username: 'console',
      passwordFile: join(root, 'password'),
      exclusiveSchema: true,
    };
    context = {
      jobId: 'mysql-job',
      database,
      dataDir: join(root, 'data'),
      backupDir: join(root, 'private'),
      servicesStopped: true,
    };
    await fs.mkdir(context.dataDir, { mode: 0o700 });
    await fs.writeFile(
      database.passwordFile,
      'secret "quote" \\ newline\nnext\n',
      { mode: 0o600 },
    );
    await fs.writeFile(join(context.dataDir, 'avatar'), 'old-avatar');
    calls = [];
    options = [];
    engine = 'InnoDB';
    connections = '0';
    references = '0';
    triggers = '';
    upgraded = false;
    dumpFails = false;
    restoreFails = false;
    incomplete = false;
    tlsCipher = '';
    family = 'mariadb';
    grants =
      'GRANT PROCESS ON *.* TO `console`@`%`\nGRANT ALL PRIVILEGES ON `console_app`.* TO `console`@`%`\n';
    runner = async (command) => {
      calls.push(command);
      if (command.args.includes('--version'))
        return family === 'mysql'
          ? 'mysql Ver 8.4.4 for Linux'
          : 'mysql from 11.4.5-MariaDB, client 15.2';
      const optionFile = command.args[0].replace('--defaults-file=', '');
      options.push(await fs.readFile(optionFile, 'utf8'));
      if (process.platform !== 'win32')
        expect((await fs.stat(optionFile)).mode & 0o077).toBe(0);
      if (command.outputFile) {
        if (dumpFails)
          throw new UpdateError(
            'BACKUP_TOOL_FAILED',
            'A database backup or restore command failed.',
          );
        await fs.writeFile(
          command.outputFile,
          '-- MySQL dump\nCREATE TABLE users(id INT);\n' +
            (incomplete ? '' : '-- Dump completed on 2026-09-29 12:00:00\n'),
          { mode: 0o600 },
        );
        return '';
      }
      if (command.inputFile) {
        if (restoreFails)
          throw new UpdateError(
            'BACKUP_TOOL_FAILED',
            'A database backup or restore command failed.',
          );
        upgraded = false;
        return '';
      }
      const sql = command.input ?? '';
      if (sql.includes('SHOW GRANTS')) return grants;
      if (sql.includes('SELECT @@server_uuid'))
        return '12345678-1234-5678-1234-123456789012\n';
      if (sql.includes('SELECT VERSION()'))
        return '8.4.4\tMySQL Community Server - GPL\tON\t0\n';
      if (sql.includes('Ssl_cipher')) return `Ssl_cipher\t${tlsCipher}\n`;
      if (sql.includes('information_schema.PROCESSLIST'))
        return `${connections}\n`;
      if (sql.includes('information_schema.KEY_COLUMN_USAGE'))
        return references;
      if (sql.includes('information_schema.SCHEMATA'))
        return 'utf8mb4\tutf8mb4_0900_ai_ci\n';
      if (sql.includes('information_schema.TABLES'))
        return (
          (upgraded ? 'new_table\tInnoDB\tBASE TABLE\t200\n' : '') +
          `users\t${engine}\tBASE TABLE\t100\n`
        );
      if (sql.includes('information_schema.TRIGGERS')) return triggers;
      if (
        sql.includes('information_schema.EVENTS') ||
        sql.includes('information_schema.ROUTINES')
      )
        return '';
      if (sql.includes('SELECT COUNT(*)')) return '1\n';
      if (sql.includes('CHECKSUM TABLE')) return 'console_app.users\t12345\n';
      if (sql.includes('SHOW CREATE TABLE'))
        return 'users\tCREATE TABLE `users` (`id` int PRIMARY KEY) ENGINE=InnoDB\n';
      if (sql.includes('DROP TABLE')) return '';
      throw new Error('Unexpected SQL in contract test');
    };
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const adapter = () => new MysqlBackupAdapter(runner);

  it.each([
    [
      'Alpine MariaDB',
      'mysql from 11.8.8-MariaDB, client 15.2 for Linux (x86_64)',
      'mysqldump from 11.8.8-MariaDB, client 10.19 for Linux (x86_64)',
      false,
    ],
    [
      'Debian default-mysql-client',
      'mysql  Ver 15.1 Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64) using EditLine wrapper',
      'mysqldump  Ver 10.19 Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)',
      false,
    ],
    [
      'Oracle MySQL',
      'mysql  Ver 8.4.4 for Linux on x86_64 (MySQL Community Server - GPL)',
      'mysqldump  Ver 10.13 Distrib 8.4.4, for Linux (x86_64)',
      true,
    ],
  ] as const)(
    'recognizes %s query/dump version formats and chooses compatible arguments',
    async (_label, queryVersion, dumpVersion, oracle) => {
      const base = runner;
      runner = async (command) => {
        if (command.args.includes('--version')) {
          calls.push(command);
          return command.executable.includes('dump')
            ? dumpVersion
            : queryVersion;
        }
        return base(command);
      };
      await adapter().backup(context);
      const dump = calls.find((call) => call.outputFile)!;
      expect(dump.args.includes('--set-gtid-purged=OFF')).toBe(oracle);
      expect(dump.args.includes('--column-statistics=0')).toBe(oracle);
      expect(options.every((value) => !value.includes('connect-timeout'))).toBe(
        true,
      );
    },
  );

  it('uses MariaDB binary names when mysql/mysqldump aliases are absent', async () => {
    const base = runner;
    runner = async (command) => {
      if (['mysql', 'mysqldump'].includes(command.executable)) {
        throw new UpdateError(
          'BACKUP_TOOL_UNAVAILABLE',
          'A required database backup tool is unavailable.',
        );
      }
      return base(command);
    };
    await adapter().backup(context);
    expect(calls.find((call) => call.outputFile)?.executable).toBe(
      'mariadb-dump',
    );
    expect(
      calls
        .filter((call) => call.input)
        .every((call) => call.executable === 'mariadb'),
    ).toBe(true);
  });

  it('rejects mismatched query and dump release series before connecting', async () => {
    const base = runner;
    runner = async (command) => {
      if (
        command.args.includes('--version') &&
        command.executable.includes('dump')
      ) {
        calls.push(command);
        return 'mysqldump  Ver 10.19 Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)';
      }
      return base(command);
    };
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_CLIENT_MISMATCH',
    );
    expect(calls.some((call) => call.input)).toBe(false);
  });

  it('accepts schema-only restore grants without global CREATE DATABASE and preserves options', async () => {
    expect(await adapter().preflight(context)).toEqual([]);
    expect(options[0]).toContain('default-character-set=utf8mb4');
    expect(options[0]).not.toContain('connect-timeout');
    expect(options[0]).toContain(
      'password="secret \\"quote\\" \\\\ newline\\nnext"',
    );
    expect(JSON.stringify(calls)).not.toContain('secret');
    expect(
      (await fs.readdir(context.backupDir)).some((name) =>
        name.startsWith('.mysql-client-'),
      ),
    ).toBe(false);
    expect(
      calls.some((call) =>
        /CREATE DATABASE|DROP DATABASE/.test(call.input ?? ''),
      ),
    ).toBe(false);
  });
  it('requires exclusive schema ownership and proves other sessions are absent', async () => {
    if (context.database.kind !== 'mysql') throw new Error('test database');
    context.database.exclusiveSchema = false;
    expect(await adapter().preflight(context)).toEqual([
      expect.objectContaining({ code: 'MYSQL_SCHEMA_NOT_EXCLUSIVE' }),
    ]);
    expect(calls).toHaveLength(0);
    context.database.exclusiveSchema = true;
    connections = '1';
    expect(await adapter().preflight(context)).toEqual([
      expect.objectContaining({ code: 'MYSQL_EXTERNAL_WRITER' }),
    ]);
  });
  it.each([
    'mysql',
    'information_schema',
    'sys',
    'performance_schema',
    'app; DROP DATABASE sibling',
  ])('rejects unsafe or system schema %s', async (database) => {
    if (context.database.kind !== 'mysql') throw new Error('test database');
    context.database.database = database;
    expect(await adapter().preflight(context)).toEqual([
      expect.objectContaining({ code: 'MYSQL_SCHEMA_INVALID' }),
    ]);
    expect(calls).toHaveLength(0);
  });
  it('blocks incomplete privileges, nontransactional tables and custom objects', async () => {
    grants = 'GRANT SELECT ON `console_app`.* TO `console`@`%`\n';
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_PROCESS_PRIVILEGE_REQUIRED',
    );
    grants += 'GRANT PROCESS ON *.* TO `console`@`%`\n';
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_RESTORE_PRIVILEGES_REQUIRED',
    );
    grants += 'GRANT ALL PRIVILEGES ON `console_app`.* TO `console`@`%`\n';
    engine = 'MyISAM';
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_ENGINE_UNSUPPORTED',
    );
    engine = 'InnoDB';
    triggers = 'custom_trigger\n';
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_OBJECT_UNSUPPORTED',
    );
  });
  it('rejects cross-schema foreign keys before destructive operations', async () => {
    references = '1';
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_CROSS_SCHEMA_REFERENCE',
    );
    expect(calls.some((call) => call.input?.includes('DROP TABLE'))).toBe(
      false,
    );
  });
  it('does not treat a globally granted but schema-revoked privilege as restorable', async () => {
    grants =
      'GRANT ALL PRIVILEGES ON *.* TO `console`@`%`\nREVOKE INSERT ON `console_app`.* FROM `console`@`%`\n';
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_RESTORE_PRIVILEGES_REQUIRED',
    );
    expect(calls.some((call) => call.outputFile)).toBe(false);
  });
  it('requires configured TLS to be active and retains identity verification', async () => {
    if (context.database.kind !== 'mysql') throw new Error('test database');
    context.database.tls = { rejectUnauthorized: true };
    expect((await adapter().preflight(context))[0].code).toBe(
      'MYSQL_TLS_NOT_ACTIVE',
    );
    expect(options[0]).toContain('ssl-verify-server-cert=1');
    tlsCipher = 'TLS_AES_256_GCM_SHA384';
    family = 'mysql';
    expect(await adapter().preflight(context)).toEqual([]);
    expect(options.at(-1)).toContain('ssl-mode=VERIFY_IDENTITY');
  });
  it('uses complete immutable dumps and removes newly added objects only in the application schema', async () => {
    const saved = await adapter().backup(context);
    await adapter().validate(context, saved);
    upgraded = true;
    await fs.writeFile(join(context.dataDir, 'avatar'), 'new-avatar');
    await adapter().restore(context, saved);
    const cleanup = calls.find((call) =>
      call.input?.includes('DROP TABLE'),
    )!.input!;
    expect(cleanup).toContain('DROP TABLE `console_app`.`new_table`;');
    expect(cleanup).toContain('DROP TABLE `console_app`.`users`;');
    expect(cleanup).not.toMatch(
      /DROP DATABASE|CREATE DATABASE|GRANT |SET GLOBAL|sibling/,
    );
    expect(await fs.readFile(join(context.dataDir, 'avatar'), 'utf8')).toBe(
      'old-avatar',
    );
    const dump = calls.find((call) => call.outputFile)!;
    expect(dump.args).toEqual(
      expect.arrayContaining([
        '--single-transaction',
        '--no-tablespaces',
        '--skip-add-locks',
      ]),
    );
    expect(dump.args).not.toContain('--set-gtid-purged=OFF');
    expect(dump.args).not.toContain('--connect-timeout=10');
    expect(calls.find((call) => call.inputFile)!.args).toEqual(
      expect.arrayContaining(['--binary-mode', '--local-infile=0']),
    );
  });
  it('uses Oracle-only compatibility options only with Oracle clients', async () => {
    family = 'mysql';
    await adapter().backup(context);
    expect(calls.find((call) => call.outputFile)!.args).toEqual(
      expect.arrayContaining([
        '--set-gtid-purged=OFF',
        '--column-statistics=0',
        '--no-login-paths',
      ]),
    );
  });
  it.each(['failed', 'truncated'])(
    'does not publish a %s database dump as a snapshot',
    async (failure) => {
      dumpFails = failure === 'failed';
      incomplete = failure === 'truncated';
      await expect(adapter().backup(context)).rejects.toMatchObject({
        code: dumpFails ? 'BACKUP_TOOL_FAILED' : 'MYSQL_DUMP_INCOMPLETE',
      });
      expect(await fs.readFile(join(context.dataDir, 'avatar'), 'utf8')).toBe(
        'old-avatar',
      );
      await expect(
        fs.stat(join(context.backupDir, 'snapshot')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        (await fs.readdir(context.backupDir)).some((name) =>
          name.startsWith('.mysql-client-'),
        ),
      ).toBe(false);
    },
  );
  it('does not report successful recovery or restore files after a failed import', async () => {
    const saved = await adapter().backup(context);
    await fs.writeFile(join(context.dataDir, 'avatar'), 'changed');
    restoreFails = true;
    await expect(adapter().restore(context, saved)).rejects.toMatchObject({
      code: 'BACKUP_TOOL_FAILED',
    });
    expect(await fs.readFile(join(context.dataDir, 'avatar'), 'utf8')).toBe(
      'changed',
    );
    expect(
      (await fs.stat(join(saved.path, 'database.sql'))).size,
    ).toBeGreaterThan(0);
    restoreFails = false;
    await adapter().restore(context, saved);
    expect(await fs.readFile(join(context.dataDir, 'avatar'), 'utf8')).toBe(
      'old-avatar',
    );
  });
  it('blocks a changed client family before any schema cleanup', async () => {
    const saved = await adapter().backup(context);
    family = 'mysql';
    calls = [];
    await expect(adapter().restore(context, saved)).rejects.toMatchObject({
      code: 'MYSQL_CLIENT_CHANGED',
    });
    expect(calls.some((call) => call.input?.includes('DROP TABLE'))).toBe(
      false,
    );
  });
  it('rejects corruption and absent stopped-writer proof before destructive SQL', async () => {
    const saved = await adapter().backup(context);
    calls = [];
    await expect(
      adapter().restore({ ...context, servicesStopped: false }, saved),
    ).rejects.toMatchObject({ code: 'BACKUP_MAINTENANCE_REQUIRED' });
    await fs.appendFile(join(saved.path, 'database.sql'), 'tampered');
    await expect(adapter().restore(context, saved)).rejects.toMatchObject({
      code: 'BACKUP_DATABASE_INVALID',
    });
    expect(calls).toHaveLength(0);
  });
});
