import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';
import { FixMySqlDefaultUserGroupIndex1790985600001 } from '../migrations/1790985600001-FixMySqlDefaultUserGroupIndex';
import { AddPasswordResetTokens1790985600002 } from '../migrations/1790985600002-AddPasswordResetTokens';
import { AddDeviceTombstones1791040000000 } from '../migrations/1791040000000-AddDeviceTombstones';
import { AddDeviceTombstoneIdReleased1791126400000 } from '../migrations/1791126400000-AddDeviceTombstoneIdReleased';
import { migrateDatabase } from './migration-manager';

const describeMysql = process.env.RUN_MYSQL_MIGRATION_TESTS
  ? describe
  : describe.skip;

describeMysql('MySQL database migrations', () => {
  const common = {
    type: 'mysql' as const,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    entities: DATABASE_ENTITIES,
    migrations: [
      InitialSchema1790985600000,
      FixMySqlDefaultUserGroupIndex1790985600001,
      AddPasswordResetTokens1790985600002,
      AddDeviceTombstones1791040000000,
      AddDeviceTombstoneIdReleased1791126400000,
    ],
  };
  const databases = [
    'rustdesk_migration_fresh',
    'rustdesk_migration_legacy',
    'rustdesk_migration_partial',
    'rustdesk_migration_destructive',
  ];

  function source(database: string, synchronize = false): DataSource {
    return new DataSource({ ...common, database, synchronize });
  }

  beforeAll(async () => {
    const admin = source('mysql');
    await admin.initialize();
    try {
      for (const database of databases) {
        await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await admin.query(`CREATE DATABASE \`${database}\``);
      }
    } finally {
      await admin.destroy();
    }
  });

  afterAll(async () => {
    const admin = source('mysql');
    await admin.initialize();
    try {
      for (const database of databases) {
        await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      }
    } finally {
      await admin.destroy();
    }
  });

  it('creates a fresh schema without drift', async () => {
    const dataSource = source(databases[0]);
    const concurrent = source(databases[0]);
    await dataSource.initialize();
    await concurrent.initialize();
    try {
      await Promise.all([
        migrateDatabase(dataSource),
        migrateDatabase(concurrent),
      ]);
      expect(await dataSource.showMigrations()).toBe(false);
      expect(
        (await dataSource.driver.createSchemaBuilder().log()).upQueries,
      ).toHaveLength(0);
      expect(
        await dataSource.query('SELECT name FROM migrations'),
      ).toHaveLength(5);
      await dataSource.query(
        "INSERT INTO user_groups (guid, name, normalizedName, isDefault) VALUES ('a', 'A', 'a', 0), ('b', 'B', 'b', 0), ('d', 'D', 'd', 1)",
      );
      await expect(
        dataSource.query(
          "INSERT INTO user_groups (guid, name, normalizedName, isDefault) VALUES ('e', 'E', 'e', 1)",
        ),
      ).rejects.toThrow();
    } finally {
      await dataSource.destroy();
      await concurrent.destroy();
    }
  });

  it('baselines an existing schema and preserves rows', async () => {
    const legacy = source(databases[1], true);
    await legacy.initialize();
    await legacy.query(
      'CREATE UNIQUE INDEX `UQ_user_groups_single_default` ON `user_groups` (`isDefault`)',
    );
    await legacy.query(
      "INSERT INTO strategies (guid, name) VALUES ('keep-me', 'retained')",
    );
    await legacy.destroy();

    const dataSource = source(databases[1]);
    await dataSource.initialize();
    try {
      await migrateDatabase(dataSource);
      expect(
        await dataSource.query(
          "SELECT name FROM strategies WHERE guid = 'keep-me'",
        ),
      ).toEqual([{ name: 'retained' }]);
      expect(
        await dataSource.query('SELECT name FROM migrations'),
      ).toHaveLength(5);
      await dataSource.query(
        "INSERT INTO user_groups (guid, name, normalizedName, isDefault) VALUES ('a', 'A', 'a', 0), ('b', 'B', 'b', 0)",
      );
    } finally {
      await dataSource.destroy();
    }
  });

  it('repairs a half-initialized database before baselining', async () => {
    // Older releases failed mid-synchronize on MySQL 8 (TEXT column with a
    // literal default), leaving the database with only part of the tables.
    const legacy = source(databases[2], true);
    await legacy.initialize();
    await legacy.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of [
      'oidc_providers',
      'oidc_auth_states',
      'device_groups',
      'device_group_user_permissions',
      'login_sessions',
      'passkey_credentials',
      'system_settings',
      'active_connections',
      'roles',
      'role_permissions',
      'user_role_assignments',
      'user_role_assignment_device_groups',
      'console_audits',
      'user_user_permissions',
      'nexus_tokens',
      'nexus_builds',
    ]) {
      await legacy.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
    await legacy.query('SET FOREIGN_KEY_CHECKS = 1');
    await legacy.query(
      "INSERT INTO strategies (guid, name) VALUES ('keep-me', 'retained')",
    );
    await legacy.destroy();

    const dataSource = source(databases[2]);
    await dataSource.initialize();
    try {
      await migrateDatabase(dataSource);
      expect(
        await dataSource.query(
          "SELECT name FROM strategies WHERE guid = 'keep-me'",
        ),
      ).toEqual([{ name: 'retained' }]);
      expect(
        (await dataSource.driver.createSchemaBuilder().log()).upQueries,
      ).toHaveLength(0);
      expect(
        await dataSource.query('SELECT name FROM migrations'),
      ).toHaveLength(5);
    } finally {
      await dataSource.destroy();
    }
  });

  it('refuses a repair that needs destructive statements', async () => {
    const legacy = source(databases[3], true);
    await legacy.initialize();
    await legacy.query('CREATE INDEX `legacy_manual_idx` ON `users` (`email`)');
    await legacy.destroy();

    const dataSource = source(databases[3]);
    await dataSource.initialize();
    try {
      await expect(migrateDatabase(dataSource)).rejects.toThrow(
        'requires destructive statements',
      );
      expect(await dataSource.createQueryRunner().hasTable('migrations')).toBe(
        false,
      );
    } finally {
      await dataSource.destroy();
    }
  });
});
