import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';
import { FixMySqlDefaultUserGroupIndex1790985600001 } from '../migrations/1790985600001-FixMySqlDefaultUserGroupIndex';
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
      ).toHaveLength(2);
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
      ).toHaveLength(2);
    } finally {
      await dataSource.destroy();
    }
  });

  it('repairs and baselines an incomplete legacy schema', async () => {
    const dataSource = source(databasePath());
    await dataSource.initialize();
    try {
      await dataSource.query(
        'CREATE TABLE strategies (guid varchar PRIMARY KEY, name varchar)',
      );
      await migrateDatabase(dataSource);
      expect(await dataSource.createQueryRunner().hasTable('migrations')).toBe(
        true,
      );
      expect(
        (await dataSource.driver.createSchemaBuilder().log()).upQueries,
      ).toHaveLength(0);
    } finally {
      await dataSource.destroy();
    }
  });
});
