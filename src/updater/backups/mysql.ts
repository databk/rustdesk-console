import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  BackupAdapter,
  BackupContext,
  BackupSnapshot,
  Blocker,
  DatabaseConfig,
} from '../contracts';
import { assert, safeError, UpdateError } from '../errors';
import { digest } from '../io';
import { runBackupCommand, type BackupCommandRunner } from './process';
import {
  assertContext,
  beginSnapshot,
  checkSpace,
  completeSnapshot,
  copyFiles,
  noLinks,
  readSnapshot,
  requireStopped,
  restoreFiles,
  scanFiles,
} from './storage';

type MysqlConfig = Extract<DatabaseConfig, { kind: 'mysql' }>;
interface Client {
  mysql: string;
  dump: string;
  family: 'mysql' | 'mariadb';
  version: string;
}
interface Session {
  client: Client;
  optionFile: string;
  home: string;
  config: MysqlConfig;
}
interface Table {
  name: string;
  engine: string;
  type: string;
  bytes: number;
}
interface Routine {
  name: string;
  type: 'PROCEDURE' | 'FUNCTION';
}
interface Inventory {
  version: string;
  serverIdentity: string;
  charset: string;
  collation: string;
  tables: Table[];
  triggers: string[];
  events: string[];
  routines: Routine[];
  bytes: number;
}
interface TableProof {
  name: string;
  rows: string;
  checksum: string;
  definition: string;
}
const IDENTIFIER = /^[a-zA-Z0-9_$]{1,64}$/;
const SCHEMA = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SYSTEM_SCHEMAS = new Set([
  'mysql',
  'sys',
  'information_schema',
  'performance_schema',
]);
const REQUIRED = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'REFERENCES',
  'SHOW VIEW',
  'TRIGGER',
  'EVENT',
  'EXECUTE',
  'ALTER ROUTINE',
];

function quote(name: string): string {
  assert(
    IDENTIFIER.test(name),
    'MYSQL_OBJECT_UNSUPPORTED',
    'The application schema contains an unsupported object name.',
  );
  return '`' + name + '`';
}
function option(value: string): string {
  assert(
    !value.includes('\0'),
    'MYSQL_CONFIGURATION_INVALID',
    'A database option contains an invalid character.',
  );
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}
function lines(value: string): string[][] {
  return value
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split('\t'));
}
function versionInfo(value: string): {
  family: Client['family'];
  version: string;
  major: number;
  minor: number;
} {
  const match = /(?:Distrib|Ver|from)\s+(\d+)\.(\d+)\.(\d+)/i.exec(value);
  assert(
    match,
    'MYSQL_CLIENT_UNSUPPORTED',
    'The database client version could not be established.',
  );
  const family = /mariadb/i.test(value) ? 'mariadb' : 'mysql';
  const major = Number(match[1]);
  const minor = Number(match[2]);
  assert(
    family === 'mysql'
      ? major === 8 && [0, 4].includes(minor)
      : (major === 10 && minor >= 11) || major === 11,
    'MYSQL_CLIENT_UNSUPPORTED',
    'The installed database client version is not supported.',
  );
  return {
    family,
    version: `${match[1]}.${match[2]}.${match[3]}`,
    major,
    minor,
  };
}

export class MysqlBackupAdapter implements BackupAdapter {
  constructor(private readonly run: BackupCommandRunner = runBackupCommand) {}

  private config(context: BackupContext): MysqlConfig {
    assert(
      context.database.kind === 'mysql',
      'BACKUP_DATABASE_MISMATCH',
      'The backup adapter does not match the configured database.',
    );
    const config = context.database;
    assert(
      config.exclusiveSchema === true,
      'MYSQL_SCHEMA_NOT_EXCLUSIVE',
      'Automatic recovery requires a schema used exclusively by this Console installation.',
    );
    assert(
      SCHEMA.test(config.database) &&
        !SYSTEM_SCHEMAS.has(config.database.toLowerCase()),
      'MYSQL_SCHEMA_INVALID',
      'A dedicated, non-system application schema is required.',
    );
    assert(
      typeof config.host === 'string' &&
        config.host.length > 0 &&
        config.host.length <= 255 &&
        !Array.from(config.host).some((char) => char.charCodeAt(0) <= 32) &&
        typeof config.username === 'string' &&
        config.username.length > 0 &&
        config.username.length <= 128 &&
        Number.isInteger(config.port) &&
        config.port > 0 &&
        config.port <= 65535,
      'MYSQL_CONFIGURATION_INVALID',
      'The managed database connection configuration is invalid.',
    );
    assert(
      !config.tls || !!config.tls.cert === !!config.tls.key,
      'MYSQL_TLS_INVALID',
      'TLS client certificate and key must be configured together.',
    );
    return config;
  }
  private async client(): Promise<Client> {
    for (const [mysql, dump] of [
      ['mysql', 'mysqldump'],
      ['mariadb', 'mariadb-dump'],
    ]) {
      let first: string;
      let second: string;
      try {
        first = await this.run({
          executable: mysql,
          args: ['--no-defaults', '--version'],
        });
        second = await this.run({
          executable: dump,
          args: ['--no-defaults', '--version'],
        });
      } catch {
        continue;
      }
      const a = versionInfo(first);
      const b = versionInfo(second);
      assert(
        a.family === b.family && a.major === b.major && a.minor === b.minor,
        'MYSQL_CLIENT_MISMATCH',
        'The database and dump clients must use the same supported release series.',
      );
      return { mysql, dump, family: a.family, version: a.version };
    }
    throw new UpdateError(
      'MYSQL_CLIENT_UNAVAILABLE',
      'Supported mysql/mysqldump or mariadb/mariadb-dump clients are required.',
    );
  }
  private async session<T>(
    context: BackupContext,
    operation: (session: Session) => Promise<T>,
  ): Promise<T> {
    await assertContext(context);
    const config = this.config(context);
    const client = await this.client();
    await noLinks(config.passwordFile);
    const info = await fs.stat(config.passwordFile);
    assert(
      info.isFile() &&
        info.nlink === 1 &&
        info.size <= 16_384 &&
        (process.platform === 'win32' || (info.mode & 0o077) === 0),
      'MYSQL_CREDENTIAL_PERMISSIONS',
      'The database password must be held in a private regular credential file.',
    );
    const password = (await fs.readFile(config.passwordFile, 'utf8')).replace(
      /\r?\n$/,
      '',
    );
    const home = await fs.mkdtemp(join(context.backupDir, '.mysql-client-'));
    const optionFile = join(home, 'client.cnf');
    try {
      const settings: string[] = [
        '[client]',
        `host=${option(config.host)}`,
        `port=${config.port}`,
        `user=${option(config.username)}`,
        `password=${option(password)}`,
        'protocol=TCP',
        'default-character-set=utf8mb4',
      ];
      if (config.tls) {
        for (const [key, value] of [
          ['ssl-ca', config.tls.ca],
          ['ssl-cert', config.tls.cert],
          ['ssl-key', config.tls.key],
        ]) {
          if (value) {
            await noLinks(value);
            settings.push(`${key}=${option(value)}`);
          }
        }
        settings.push(
          ...(client.family === 'mysql'
            ? [
                `ssl-mode=${config.tls.rejectUnauthorized ? 'VERIFY_IDENTITY' : 'REQUIRED'}`,
              ]
            : [
                'ssl=1',
                `ssl-verify-server-cert=${config.tls.rejectUnauthorized ? '1' : '0'}`,
              ]),
        );
      } else
        settings.push(
          client.family === 'mysql' ? 'ssl-mode=DISABLED' : 'ssl=0',
        );
      await fs.writeFile(optionFile, settings.join('\n') + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      return await operation({ client, optionFile, home, config });
    } finally {
      // 进程退出后才删除临时凭据；异常输出从不传出 runner。
      await fs.rm(home, { recursive: true, force: true });
    }
  }
  private args(session: Session): string[] {
    return [
      `--defaults-file=${session.optionFile}`,
      ...(session.client.family === 'mysql' ? ['--no-login-paths'] : []),
      '--batch',
      '--raw',
      '--skip-column-names',
      '--binary-mode',
      '--skip-reconnect',
      '--connect-timeout=10',
      '--local-infile=0',
      `--database=${session.config.database}`,
    ];
  }
  private query(session: Session, sql: string): Promise<string> {
    return this.run({
      executable: session.client.mysql,
      args: this.args(session),
      home: session.home,
      cwd: session.home,
      input: `SET SESSION time_zone='+00:00';\n${sql}\n`,
      timeoutMs: 30 * 60_000,
    });
  }
  private async privileges(session: Session): Promise<void> {
    const grants = lines(
      await this.query(session, 'SHOW GRANTS FOR CURRENT_USER;'),
    ).map((row) => row.join('\t'));
    const global = new Set<string>();
    const schema = new Set<string>();
    for (const grant of grants) {
      const revoke = /^REVOKE .+ ON (.+) FROM /i.exec(grant);
      assert(
        !revoke ||
          revoke[1].replace(/`/g, '').replace(/\\_/g, '_') !==
            `${session.config.database}.*`,
        'MYSQL_RESTORE_PRIVILEGES_REQUIRED',
        'A partial privilege revocation prevents proving application-schema restore permissions.',
      );
      const match = /^GRANT (.+) ON (.+) TO /i.exec(grant);
      if (!match) continue;
      const scope = match[2].replace(/`/g, '').replace(/\\_/g, '_');
      const target =
        scope === '*.*'
          ? global
          : scope === `${session.config.database}.*`
            ? schema
            : undefined;
      for (const permission of match[1].split(','))
        target?.add(permission.trim().toUpperCase());
    }
    assert(
      global.has('ALL PRIVILEGES') || global.has('PROCESS'),
      'MYSQL_PROCESS_PRIVILEGE_REQUIRED',
      'The backup account needs PROCESS visibility to detect other schema connections.',
    );
    assert(
      global.has('ALL PRIVILEGES') ||
        schema.has('ALL PRIVILEGES') ||
        REQUIRED.every(
          (permission) => global.has(permission) || schema.has(permission),
        ),
      'MYSQL_RESTORE_PRIVILEGES_REQUIRED',
      'The backup account lacks required application-schema inspection or restore privileges.',
    );
  }
  private async inspect(
    session: Session,
    stopped: boolean,
    recovering = false,
  ): Promise<Inventory> {
    await this.privileges(session);
    const server = lines(
      await this.query(
        session,
        'SELECT VERSION(), @@version_comment, @@global.event_scheduler, @@global.read_only;',
      ),
    )[0];
    assert(
      server?.length === 4,
      'MYSQL_INSPECTION_FAILED',
      'The database server configuration could not be established.',
    );
    const maria = /mariadb/i.test(server[0]);
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(server[0]);
    assert(
      match &&
        (maria
          ? (Number(match[1]) === 10 && Number(match[2]) >= 11) ||
            Number(match[1]) === 11
          : Number(match[1]) === 8 && [0, 4].includes(Number(match[2]))),
      'MYSQL_SERVER_UNSUPPORTED',
      'The database server release series is not supported for automatic recovery.',
    );
    assert(
      !maria || session.client.family === 'mariadb',
      'MYSQL_CLIENT_SERVER_MISMATCH',
      'This server requires the matching MariaDB client family.',
    );
    const identity = (
      await this.query(
        session,
        maria
          ? "SELECT CONCAT(@@hostname, ':', @@server_id);"
          : 'SELECT @@server_uuid;',
      )
    ).trim();
    assert(
      identity.length > 0 && identity.length < 512,
      'MYSQL_SERVER_IDENTITY_UNKNOWN',
      'The database server identity could not be established.',
    );
    assert(
      server[3] === '0',
      'MYSQL_BACKGROUND_WRITES_UNSAFE',
      'Recovery requires a writable database server.',
    );
    const tls = lines(
      await this.query(session, "SHOW SESSION STATUS LIKE 'Ssl_cipher';"),
    )[0];
    assert(
      !session.config.tls || (tls?.[0] === 'Ssl_cipher' && !!tls[1]),
      'MYSQL_TLS_NOT_ACTIVE',
      'The database connection did not establish the configured TLS protection.',
    );
    const connections = lines(
      await this.query(
        session,
        `SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND (DB = DATABASE() OR USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1))${stopped ? '' : " AND USER <> SUBSTRING_INDEX(CURRENT_USER(), '@', 1)"};`,
      ),
    );
    assert(
      connections[0]?.[0] === '0',
      'MYSQL_EXTERNAL_WRITER',
      'Other database connections prevent an exclusive application-schema snapshot.',
    );
    const references = (
      await this.query(
        session,
        'SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA IS NOT NULL AND TABLE_SCHEMA <> REFERENCED_TABLE_SCHEMA AND (TABLE_SCHEMA = DATABASE() OR REFERENCED_TABLE_SCHEMA = DATABASE());',
      )
    ).trim();
    assert(
      references === '0',
      'MYSQL_CROSS_SCHEMA_REFERENCE',
      'Cross-schema foreign keys prevent isolated application-schema recovery.',
    );
    const properties = lines(
      await this.query(
        session,
        'SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE();',
      ),
    )[0];
    assert(
      properties?.length === 2 &&
        IDENTIFIER.test(properties[0]) &&
        IDENTIFIER.test(properties[1]),
      'MYSQL_SCHEMA_INVALID',
      'The application schema character set could not be established.',
    );
    const tableRows = lines(
      await this.query(
        session,
        "SELECT TABLE_NAME, COALESCE(ENGINE, ''), TABLE_TYPE, COALESCE(DATA_LENGTH,0) + COALESCE(INDEX_LENGTH,0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;",
      ),
    );
    assert(
      tableRows.length > 0 || recovering,
      'MYSQL_SCHEMA_EMPTY',
      'The application schema has no tables to protect.',
    );
    assert(
      tableRows.length <= 512,
      'MYSQL_OBJECT_LIMIT',
      'The application schema exceeds the supported object limit.',
    );
    const tables = tableRows.map(([name, engine, type, bytes]) => {
      quote(name);
      assert(
        ['BASE TABLE', 'VIEW'].includes(type) &&
          Number.isSafeInteger(Number(bytes)) &&
          Number(bytes) >= 0,
        'MYSQL_OBJECT_UNSUPPORTED',
        'The application schema contains an unsupported object.',
      );
      return { name, engine, type, bytes: Number(bytes) };
    });
    const triggers = lines(
      await this.query(
        session,
        'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME;',
      ),
    ).map(([name]) => name);
    const events = lines(
      await this.query(
        session,
        'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE() ORDER BY EVENT_NAME;',
      ),
    ).map(([name]) => name);
    const routines = lines(
      await this.query(
        session,
        'SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME;',
      ),
    ).map(([name, type]): Routine => {
      assert(
        type === 'PROCEDURE' || type === 'FUNCTION',
        'MYSQL_OBJECT_UNSUPPORTED',
        'The schema contains an unsupported routine.',
      );
      return { name, type };
    });
    assert(
      !recovering || events.length === 0 || server[2] !== 'ON',
      'MYSQL_BACKGROUND_WRITES_UNSAFE',
      'Active application-schema events must be stopped before recovery.',
    );
    for (const name of [
      ...triggers,
      ...events,
      ...routines.map((routine) => routine.name),
    ])
      quote(name);
    if (!recovering) {
      assert(
        tables.every(
          (table) => table.type === 'BASE TABLE' && table.engine === 'InnoDB',
        ),
        'MYSQL_ENGINE_UNSUPPORTED',
        'Automatic snapshots support the Console InnoDB tables; views and other engines require manual updates.',
      );
      assert(
        triggers.length === 0 && events.length === 0 && routines.length === 0,
        'MYSQL_OBJECT_UNSUPPORTED',
        'Custom triggers, routines, or events prevent automatic application-schema recovery.',
      );
    }
    return {
      version: server[0],
      serverIdentity: digest(identity),
      charset: properties[0],
      collation: properties[1],
      tables,
      triggers,
      events,
      routines,
      bytes: tables.reduce((sum, table) => sum + table.bytes, 0),
    };
  }
  private async proof(
    session: Session,
    inventory: Inventory,
  ): Promise<TableProof[]> {
    const result: TableProof[] = [];
    for (const table of inventory.tables) {
      const identifier = `${quote(session.config.database)}.${quote(table.name)}`;
      const rows = (
        await this.query(session, `SELECT COUNT(*) FROM ${identifier};`)
      ).trim();
      const checksum = lines(
        await this.query(session, `CHECKSUM TABLE ${identifier} EXTENDED;`),
      )[0]?.[1];
      assert(
        /^\d+$/.test(rows) &&
          typeof checksum === 'string' &&
          /^\d+$/.test(checksum),
        'MYSQL_TABLE_VERIFICATION_UNAVAILABLE',
        'A database table cannot be verified for recoverable backup.',
      );
      const definition = digest(
        (await this.query(session, `SHOW CREATE TABLE ${identifier};`)).trim(),
      );
      result.push({ name: table.name, rows, checksum, definition });
    }
    return result;
  }
  async preflight(context: BackupContext): Promise<Blocker[]> {
    try {
      await this.session(context, async (session) => {
        const inventory = await this.inspect(session, context.servicesStopped);
        await checkSpace(context, inventory.bytes * 3);
      });
      return [];
    } catch (error) {
      return [safeError(error).blocker()];
    }
  }
  async backup(context: BackupContext): Promise<BackupSnapshot> {
    requireStopped(context);
    return this.session(context, async (session) => {
      const inventory = await this.inspect(session, true);
      await checkSpace(context, inventory.bytes * 3);
      const before = await this.proof(session, inventory);
      const staging = await beginSnapshot(context);
      const file = join(staging, 'database.sql');
      await this.run({
        executable: session.client.dump,
        args: [
          `--defaults-file=${session.optionFile}`,
          ...(session.client.family === 'mysql'
            ? [
                '--no-login-paths',
                '--set-gtid-purged=OFF',
                '--column-statistics=0',
              ]
            : []),
          '--single-transaction',
          '--quick',
          '--hex-blob',
          '--no-tablespaces',
          '--skip-lock-tables',
          '--skip-add-locks',
          '--skip-triggers',
          '--skip-routines',
          '--skip-events',
          '--tz-utc',
          '--comments',
          '--dump-date',
          '--default-character-set=utf8mb4',
          '--',
          session.config.database,
        ],
        outputFile: file,
        home: session.home,
        cwd: session.home,
        timeoutMs: 30 * 60_000,
      });
      await this.dumpComplete(file);
      const afterInventory = await this.inspect(session, true);
      assert(
        JSON.stringify(await this.proof(session, afterInventory)) ===
          JSON.stringify(before),
        'MYSQL_CONCURRENT_WRITE',
        'The application schema changed during backup.',
      );
      const files = await scanFiles(context.dataDir);
      await copyFiles(context.dataDir, join(staging, 'files'), files);
      assert(
        JSON.stringify(await scanFiles(context.dataDir)) ===
          JSON.stringify(files),
        'BACKUP_CONCURRENT_WRITE',
        'Business files changed while the application was stopped.',
      );
      return completeSnapshot(context, staging, 'database.sql', files, {
        method: 'mysql-logical-schema',
        serverVersion: inventory.version,
        serverIdentity: inventory.serverIdentity,
        clientFamily: session.client.family,
        clientVersion: session.client.version,
        charset: inventory.charset,
        collation: inventory.collation,
        tables: before,
      });
    });
  }
  private async dumpComplete(path: string): Promise<void> {
    const file = await fs.open(path, 'r');
    try {
      const size = (await file.stat()).size;
      const tail = Buffer.alloc(Math.min(size, 4096));
      await file.read(tail, 0, tail.length, size - tail.length);
      assert(
        size > 0 &&
          /-- Dump completed on [^\r\n]+\s*$/.test(tail.toString('utf8')),
        'MYSQL_DUMP_INCOMPLETE',
        'The database dump is incomplete.',
      );
    } finally {
      await file.close();
    }
  }
  async validate(
    context: BackupContext,
    snapshot: BackupSnapshot,
  ): Promise<void> {
    const manifest = await readSnapshot(context, snapshot);
    await this.dumpComplete(join(snapshot.path, manifest.databaseFile));
    const tables = manifest.details.tables;
    assert(
      Array.isArray(tables) &&
        tables.length > 0 &&
        tables.length <= 512 &&
        tables.every((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return false;
          const table = entry as TableProof;
          return (
            typeof table.name === 'string' &&
            IDENTIFIER.test(table.name) &&
            typeof table.rows === 'string' &&
            /^\d+$/.test(table.rows) &&
            typeof table.checksum === 'string' &&
            /^\d+$/.test(table.checksum) &&
            typeof table.definition === 'string' &&
            /^[0-9a-f]{64}$/.test(table.definition)
          );
        }),
      'BACKUP_MANIFEST_INVALID',
      'The database snapshot object inventory is invalid.',
    );
  }
  async restore(
    context: BackupContext,
    snapshot: BackupSnapshot,
  ): Promise<void> {
    requireStopped(context);
    await this.validate(context, snapshot);
    const manifest = await readSnapshot(context, snapshot);
    await this.session(context, async (session) => {
      const inventory = await this.inspect(session, true, true);
      assert(
        session.client.family === manifest.details.clientFamily &&
          typeof manifest.details.clientVersion === 'string' &&
          session.client.version.split('.').slice(0, 2).join('.') ===
            manifest.details.clientVersion.split('.').slice(0, 2).join('.'),
        'MYSQL_CLIENT_CHANGED',
        'The database client family or release series changed since this snapshot was taken.',
      );
      assert(
        inventory.version === manifest.details.serverVersion &&
          inventory.serverIdentity === manifest.details.serverIdentity,
        'MYSQL_SERVER_CHANGED',
        'The database server changed since this snapshot was taken.',
      );
      assert(
        inventory.charset === manifest.details.charset &&
          inventory.collation === manifest.details.collation,
        'MYSQL_SCHEMA_CHANGED',
        'The schema character set changed since this snapshot was taken.',
      );
      await checkSpace(context, manifest.databaseSize);
      const schema = quote(session.config.database);
      const cleanup = [
        'SET SESSION FOREIGN_KEY_CHECKS=0;',
        ...inventory.events.map(
          (name) => `DROP EVENT ${schema}.${quote(name)};`,
        ),
        ...inventory.routines.map(
          (routine) => `DROP ${routine.type} ${schema}.${quote(routine.name)};`,
        ),
        ...inventory.tables
          .filter((table) => table.type === 'VIEW')
          .map((table) => `DROP VIEW ${schema}.${quote(table.name)};`),
        ...inventory.tables
          .filter((table) => table.type === 'BASE TABLE')
          .map((table) => `DROP TABLE ${schema}.${quote(table.name)};`),
        'SET SESSION FOREIGN_KEY_CHECKS=1;',
      ];
      // DDL 非事务性；runtime 必须在调用前持久化 restore intent，并保持维护。
      await this.query(session, cleanup.join('\n'));
      await this.run({
        executable: session.client.mysql,
        args: this.args(session),
        home: session.home,
        cwd: session.home,
        inputFile: join(snapshot.path, manifest.databaseFile),
        timeoutMs: 30 * 60_000,
      });
      const restored = await this.inspect(session, true);
      assert(
        JSON.stringify(await this.proof(session, restored)) ===
          JSON.stringify(manifest.details.tables),
        'MYSQL_RESTORE_VERIFICATION_FAILED',
        'Restored database objects or contents failed verification.',
      );
      await restoreFiles(context, snapshot, manifest);
    });
  }
}
