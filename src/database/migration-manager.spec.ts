import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';
import { FixMySqlDefaultUserGroupIndex1790985600001 } from '../migrations/1790985600001-FixMySqlDefaultUserGroupIndex';
import { AddPasswordResetTokens1790985600002 } from '../migrations/1790985600002-AddPasswordResetTokens';
import { AddDeviceTombstones1791040000000 } from '../migrations/1791040000000-AddDeviceTombstones';
import { AddDeviceTombstoneReleaseTracking1791126400000 } from '../migrations/1791126400000-AddDeviceTombstoneReleaseTracking';
import { AddressBookPeer } from '../modules/address-book/entities/address-book-peer.entity';
import { migrateDatabase } from './migration-manager';

describe('database migrations', () => {
  const directories: string[] = [];

  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rustdesk-migration-'));
    directories.push(directory);
    return join(directory, 'console.db');
  }

  function source(database: string, synchronize = false): DataSource {
    return new DataSource({
      type: 'sqlite',
      database,
      entities: DATABASE_ENTITIES,
      migrations: [
        InitialSchema1790985600000,
        FixMySqlDefaultUserGroupIndex1790985600001,
        AddPasswordResetTokens1790985600002,
        AddDeviceTombstones1791040000000,
        AddDeviceTombstoneReleaseTracking1791126400000,
      ],
      synchronize,
    });
  }

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates a fresh schema and runs only once', async () => {
    const dataSource = source(databasePath());
    await dataSource.initialize();
    try {
      await migrateDatabase(dataSource);
      await migrateDatabase(dataSource);
      expect(await dataSource.showMigrations()).toBe(false);
      expect(
        (await dataSource.driver.createSchemaBuilder().log()).upQueries,
      ).toHaveLength(0);
      expect(
        await dataSource.query('SELECT name FROM migrations'),
      ).toHaveLength(5);
      await dataSource.query(
        "INSERT INTO address_books (guid, owner) VALUES ('book', 'owner')",
      );
      await dataSource.query(
        "INSERT INTO address_book_peers (guid, addressBookGuid, deviceId) VALUES ('peer', 'book', 'device')",
      );
      await dataSource.query(
        "INSERT INTO address_book_tags (guid, addressBookGuid, name) VALUES ('tag', 'book', 'Important')",
      );
      await dataSource.query(
        "INSERT INTO address_book_peer_tags (peerGuid, tagGuid) VALUES ('peer', 'tag')",
      );
      const peer = await dataSource.getRepository(AddressBookPeer).findOne({
        where: { guid: 'peer' },
        relations: { tagLinks: { tag: true } },
      });
      expect(peer?.tagLinks[0]?.tag.name).toBe('Important');
    } finally {
      await dataSource.destroy();
    }
  });

  it('baselines a synchronized database without changing its data', async () => {
    const database = databasePath();
    const legacy = source(database, true);
    await legacy.initialize();
    await legacy.query(
      "INSERT INTO strategies (guid, name) VALUES ('keep-me', 'retained')",
    );
    await legacy.destroy();

    const dataSource = source(database);
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
    } finally {
      await dataSource.destroy();
    }
  });

  it('repairs and baselines an incomplete schema', async () => {
    const dataSource = source(databasePath());
    await dataSource.initialize();
    try {
      await dataSource.query(
        'CREATE TABLE strategies (guid varchar PRIMARY KEY, name varchar)',
      );
      await migrateDatabase(dataSource);
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

  it('removes stray legacy unique constraints before baselining', async () => {
    const database = databasePath();
    const legacy = source(database, true);
    await legacy.initialize();
    // Recreate the strategies table the way the pre-1.9 synchronize releases
    // left it: the uniqueness enforced through a table-level constraint
    // instead of the entity-declared unique index.
    await legacy.query('DROP INDEX "IDX_c9ac805e6a43148f0647f543c2"');
    await legacy.query('DROP TABLE "strategies"');
    await legacy.query(
      `CREATE TABLE "strategies" ("guid" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "note" text, "configOptions" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_c9ac805e6a43148f0647f543c29" UNIQUE ("name"))`,
    );
    await legacy.query(
      "INSERT INTO strategies (guid, name) VALUES ('legacy', 'retained')",
    );
    await legacy.destroy();

    const dataSource = source(database);
    await dataSource.initialize();
    try {
      await migrateDatabase(dataSource);
      expect(
        await dataSource.query(
          "SELECT name FROM strategies WHERE guid = 'legacy'",
        ),
      ).toEqual([{ name: 'retained' }]);
      expect(
        (await dataSource.driver.createSchemaBuilder().log()).upQueries,
      ).toHaveLength(0);
      expect(
        await dataSource.query('SELECT name FROM migrations'),
      ).toHaveLength(5);
      const indexes = await dataSource.query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'strategies' AND sql IS NOT NULL",
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0].sql).toContain('CREATE UNIQUE INDEX');
      expect(indexes[0].sql).toContain('"name"');
      const table = await dataSource.query(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'strategies'",
      );
      expect(table[0].sql).not.toContain('UNIQUE ("name")');
      await expect(
        dataSource.query(
          "INSERT INTO strategies (guid, name) VALUES ('dup', 'retained')",
        ),
      ).rejects.toThrow();
    } finally {
      await dataSource.destroy();
    }
  }, 30000);

  it('refuses to repair when a legacy column would be dropped', async () => {
    const database = databasePath();
    const legacy = source(database, true);
    await legacy.initialize();
    await legacy.query('ALTER TABLE strategies ADD COLUMN legacyField varchar');
    await legacy.destroy();

    const dataSource = source(database);
    await dataSource.initialize();
    try {
      await expect(migrateDatabase(dataSource)).rejects.toThrow(
        'not defined in the current entities',
      );
      expect(await dataSource.createQueryRunner().hasTable('migrations')).toBe(
        false,
      );
    } finally {
      await dataSource.destroy();
    }
  });

  it('refuses to baseline a drifted database with migration history', async () => {
    const dataSource = source(databasePath());
    await dataSource.initialize();
    try {
      await dataSource.query(
        'CREATE TABLE strategies (guid varchar PRIMARY KEY, name varchar)',
      );
      await dataSource.query(
        'CREATE TABLE "migrations" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)',
      );
      await expect(migrateDatabase(dataSource)).rejects.toThrow(
        'Existing database schema differs',
      );
      expect(await dataSource.createQueryRunner().hasTable('migrations')).toBe(
        true,
      );
    } finally {
      await dataSource.destroy();
    }
  });
});
