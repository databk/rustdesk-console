import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';
import { FixMySqlDefaultUserGroupIndex1790985600001 } from '../migrations/1790985600001-FixMySqlDefaultUserGroupIndex';
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
    ],
  };
  const databases = ['rustdesk_migration_fresh', 'rustdesk_migration_legacy'];

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
      ).toHaveLength(2);
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
      ).toHaveLength(2);
      await dataSource.query(
        "INSERT INTO user_groups (guid, name, normalizedName, isDefault) VALUES ('a', 'A', 'a', 0), ('b', 'B', 'b', 0)",
      );
    } finally {
      await dataSource.destroy();
    }
  });
});
