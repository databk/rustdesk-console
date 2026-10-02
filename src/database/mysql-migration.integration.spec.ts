import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';
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
    migrations: [InitialSchema1790985600000],
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
    await dataSource.initialize();
    try {
      await migrateDatabase(dataSource);
      await migrateDatabase(dataSource);
      expect(await dataSource.showMigrations()).toBe(false);
      expect(
        (await dataSource.driver.createSchemaBuilder().log()).upQueries,
      ).toHaveLength(0);
    } finally {
      await dataSource.destroy();
    }
  });

  it('baselines an existing schema and preserves rows', async () => {
    const legacy = source(databases[1], true);
    await legacy.initialize();
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
      ).toHaveLength(1);
    } finally {
      await dataSource.destroy();
    }
  });
});
