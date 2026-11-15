import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';
import { FixMySqlDefaultUserGroupIndex1790985600001 } from '../migrations/1790985600001-FixMySqlDefaultUserGroupIndex';
import { AddPasswordResetTokens1790985600002 } from '../migrations/1790985600002-AddPasswordResetTokens';
import { AddDeviceTombstones1791040000000 } from '../migrations/1791040000000-AddDeviceTombstones';
import { AddDeviceTombstoneReleaseTracking1791126400000 } from '../migrations/1791126400000-AddDeviceTombstoneReleaseTracking';
import { ReplaceNexusWithCustomClientBuilds1791212800000 } from '../migrations/1791212800000-ReplaceNexusWithCustomClientBuilds';
import { SupportMariaDbDefaultGroupIndex1794700800000 } from '../migrations/1794700800000-SupportMariaDbDefaultGroupIndex';
import { migrateDatabase } from './migration-manager';
import { schemaDiffQueries } from './schema-diff';

const describeMysql = process.env.RUN_MYSQL_MIGRATION_TESTS
  ? describe
  : describe.skip;

describeMysql('MySQL database migrations', () => {
  const dbType: 'mysql' | 'mariadb' =
    process.env.DB_TYPE === 'mariadb' ? 'mariadb' : 'mysql';
  const common = {
    type: dbType,
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
      AddDeviceTombstoneReleaseTracking1791126400000,
      ReplaceNexusWithCustomClientBuilds1791212800000,
      SupportMariaDbDefaultGroupIndex1794700800000,
    ],
  };
  const databases = [
    'rustdesk_migration_fresh',
    'rustdesk_migration_legacy',
    'rustdesk_migration_partial',
    'rustdesk_migration_destructive',
    'rustdesk_migration_retry',
    'rustdesk_migration_incompatible',
    'rustdesk_migration_undeclared',
    'rustdesk_migration_plain_key',
    'rustdesk_migration_retype',
  ];

  const itMariaDb = dbType === 'mariadb' ? it : it.skip;

  function source(database: string, synchronize = false): DataSource {
    return new DataSource({ ...common, database, synchronize });
  }

  /**
   * The diff ignores the generated column MariaDB uses to enforce a single
   * default user group (see src/database/schema-diff.ts).
   */
  async function schemaDrift(dataSource: DataSource) {
    return schemaDiffQueries(dataSource);
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
      expect(await schemaDrift(dataSource)).toHaveLength(0);
      expect(
        await dataSource.query('SELECT name FROM migrations'),
      ).toHaveLength(7);
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
      ).toHaveLength(7);
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
      'custom_client_builds',
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
      expect(await schemaDrift(dataSource)).toHaveLength(0);
      expect(
        await dataSource.query('SELECT name FROM migrations'),
      ).toHaveLength(7);
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

  itMariaDb(
    'retries the default-group migration after partially applied DDL',
    async () => {
      const dataSource = source(databases[4]);
      const markPending = () =>
        dataSource.query(
          "DELETE FROM migrations WHERE name = 'SupportMariaDbDefaultGroupIndex1794700800000'",
        );
      await dataSource.initialize();
      try {
        await migrateDatabase(dataSource);

        // MariaDB commits DDL immediately, so a crash can leave the schema
        // applied while the migration is still pending.
        await markPending();
        await migrateDatabase(dataSource);

        // The metadata table can be lost independently of the column.
        await dataSource.query('DROP TABLE `typeorm_metadata`');
        await markPending();
        await migrateDatabase(dataSource);

        // So can the metadata row describing the generated column.
        await dataSource.query(
          "DELETE FROM `typeorm_metadata` WHERE `name` = 'isDefaultKey'",
        );
        await markPending();
        await migrateDatabase(dataSource);
        expect(
          await dataSource.query(
            "SELECT `name` FROM `typeorm_metadata` WHERE `name` = 'isDefaultKey'",
          ),
        ).toHaveLength(1);

        // Same again with the unique index missing.
        await dataSource.query(
          'DROP INDEX `UQ_user_groups_default_key` ON `user_groups`',
        );
        await markPending();
        await migrateDatabase(dataSource);

        expect(await schemaDrift(dataSource)).toHaveLength(0);
        await dataSource.query(
          "INSERT INTO user_groups (guid, name, normalizedName, isDefault) VALUES ('a', 'A', 'a', 1)",
        );
        await expect(
          dataSource.query(
            "INSERT INTO user_groups (guid, name, normalizedName, isDefault) VALUES ('b', 'B', 'b', 1)",
          ),
        ).rejects.toThrow();
      } finally {
        await dataSource.destroy();
      }
    },
    30000,
  );

  itMariaDb('refuses an incompatible default-group index', async () => {
    const dataSource = source(databases[5]);
    await dataSource.initialize();
    try {
      await migrateDatabase(dataSource);
      await dataSource.query(
        'DROP INDEX `UQ_user_groups_default_key` ON `user_groups`',
      );
      await dataSource.query(
        'CREATE INDEX `UQ_user_groups_default_key` ON `user_groups` (`isDefault`)',
      );
      await dataSource.query(
        "DELETE FROM migrations WHERE name = 'SupportMariaDbDefaultGroupIndex1794700800000'",
      );
      await expect(migrateDatabase(dataSource)).rejects.toThrow(
        'does not enforce a unique isDefaultKey',
      );
    } finally {
      await dataSource.destroy();
    }
  });

  it('refuses an undeclared isDefaultKey column that is not generated', async () => {
    // A plain column with the managed name exists on neither MySQL nor
    // MariaDB; the repair must refuse it instead of dropping its data and the
    // MariaDB diff filter must not hide it.
    const legacy = source(databases[6], true);
    await legacy.initialize();
    await legacy.query(
      'ALTER TABLE `user_groups` ADD COLUMN `isDefaultKey` tinyint NULL',
    );
    await legacy.query(
      "INSERT INTO user_groups (guid, name, normalizedName, isDefault, isDefaultKey) VALUES ('a', 'A', 'a', 0, 7)",
    );
    await legacy.destroy();

    const dataSource = source(databases[6]);
    await dataSource.initialize();
    try {
      await expect(migrateDatabase(dataSource)).rejects.toThrow(
        'not defined in the current entities',
      );
    } finally {
      await dataSource.destroy();
    }
  });

  itMariaDb(
    'refuses an isDefaultKey column it did not generate',
    async () => {
      const dataSource = source(databases[7]);
      // The initial migration stays recorded, so baselining (and its
      // undeclared-column guard) does not run before this migration.
      const markPending = () =>
        dataSource.query(
          "DELETE FROM migrations WHERE name = 'SupportMariaDbDefaultGroupIndex1794700800000'",
        );
      await dataSource.initialize();
      try {
        await migrateDatabase(dataSource);

        // A plain nullable column cannot enforce the rule: it stays NULL on
        // inserts, and a unique index accepts many NULLs.
        await dataSource.query(
          'ALTER TABLE `user_groups` DROP COLUMN `isDefaultKey`',
        );
        await dataSource.query(
          'ALTER TABLE `user_groups` ADD COLUMN `isDefaultKey` tinyint NULL',
        );
        await dataSource.query(
          "DELETE FROM `typeorm_metadata` WHERE `name` = 'isDefaultKey'",
        );
        await markPending();
        await expect(migrateDatabase(dataSource)).rejects.toThrow(
          'is not the generated column this migration manages',
        );

        // A generated column with a different expression is refused too.
        await dataSource.query(
          'ALTER TABLE `user_groups` DROP COLUMN `isDefaultKey`',
        );
        await dataSource.query(
          'ALTER TABLE `user_groups` ADD COLUMN `isDefaultKey` tinyint GENERATED ALWAYS AS (CASE WHEN `isDefault` = 0 THEN 1 ELSE NULL END) PERSISTENT',
        );
        await dataSource.query(
          "DELETE FROM `typeorm_metadata` WHERE `name` = 'isDefaultKey'",
        );
        await markPending();
        await expect(migrateDatabase(dataSource)).rejects.toThrow(
          'is not the generated column this migration manages',
        );
      } finally {
        await dataSource.destroy();
      }
    },
    30000,
  );

  it('refuses a repair that would change a column type destructively', async () => {
    // TypeORM changes a column type with DROP COLUMN + ADD COLUMN, so the
    // additive-only guard has to reject ALTER TABLE statements too.
    const legacy = source(databases[8], true);
    await legacy.initialize();
    await legacy.query(
      'ALTER TABLE `user_groups` MODIFY `note` varchar(255) NULL',
    );
    await legacy.query(
      "INSERT INTO user_groups (guid, name, normalizedName, note) VALUES ('a', 'A', 'a', 'kept')",
    );
    await legacy.destroy();

    const dataSource = source(databases[8]);
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
