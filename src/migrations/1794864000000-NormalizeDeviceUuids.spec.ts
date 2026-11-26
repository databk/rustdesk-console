import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from '../database/entities';
import { Peer, PeerStatus, Sysinfo } from '../common/entities';
import { ActiveConnection } from '../modules/heartbeat/entities/active-connection.entity';
import { DeviceTombstone } from '../modules/device-group/entities/device-tombstone.entity';
import { AddressBookPeer } from '../modules/address-book/entities/address-book-peer.entity';
import { AddressBook } from '../modules/address-book/entities/address-book.entity';
import { NormalizeDeviceUuids1794864000000 } from './1794864000000-NormalizeDeviceUuids';

const legacyBytes = Buffer.from('ffffffffffffffffffffffffffffffff', 'hex');
const legacyUuid = legacyBytes.toString('base64');
const canonicalUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

describe('NormalizeDeviceUuids migration', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: DATABASE_ENTITIES,
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  async function runMigration(): Promise<void> {
    const runner = dataSource.createQueryRunner();
    try {
      await runner.connect();
      await new NormalizeDeviceUuids1794864000000().up(runner);
    } finally {
      await runner.release();
    }
  }

  it('rewrites device-scoped rows and leaves isolation keys alone', async () => {
    const isolated = 'a'.repeat(64);
    await dataSource.getRepository(Peer).save([
      {
        uuid: legacyUuid,
        id: 'host-a',
        ver: 1,
        modifiedAt: 0,
        status: PeerStatus.ACTIVE,
      },
      {
        uuid: isolated,
        id: 'host-b',
        ver: 1,
        modifiedAt: 0,
        status: PeerStatus.ACTIVE,
      },
    ]);
    await dataSource.getRepository(Sysinfo).save({
      uuid: legacyUuid,
      hostname: 'host-a',
    });
    await dataSource.getRepository(ActiveConnection).save({
      deviceUuid: legacyUuid,
      connId: 7,
    });
    await dataSource.getRepository(DeviceTombstone).save({
      uuid: legacyUuid,
      deviceId: 'host-a',
    });

    await runMigration();

    expect(
      (await dataSource.getRepository(Peer).find()).map((peer) => peer.uuid),
    ).toEqual(expect.arrayContaining([canonicalUuid, isolated]));
    expect(await dataSource.getRepository(Sysinfo).findOneBy({})).toMatchObject(
      { uuid: canonicalUuid },
    );
    expect(
      (await dataSource.getRepository(ActiveConnection).find())[0],
    ).toMatchObject({ deviceUuid: canonicalUuid });
    expect(
      (await dataSource.getRepository(DeviceTombstone).find())[0],
    ).toMatchObject({ uuid: canonicalUuid });
  });

  it('normalises tombstones and system info without a peer row', async () => {
    const orphanUuid = Buffer.from(
      '00112233445566778899aabbccddeeff',
      'hex',
    ).toString('base64');
    const orphanCanonical = '00112233-4455-6677-8899-aabbccddeeff';
    await dataSource.getRepository(Sysinfo).save({
      uuid: orphanUuid,
      hostname: 'gone',
    });
    await dataSource.getRepository(DeviceTombstone).save({
      uuid: orphanUuid,
      deviceId: 'gone',
    });

    await runMigration();

    expect(await dataSource.getRepository(Sysinfo).findOneBy({})).toMatchObject(
      { uuid: orphanCanonical },
    );
    expect(
      (await dataSource.getRepository(DeviceTombstone).find())[0],
    ).toMatchObject({ uuid: orphanCanonical });
  });

  it('merges into an existing canonical row instead of creating a duplicate', async () => {
    await dataSource.getRepository(Peer).save([
      {
        uuid: canonicalUuid,
        id: 'host-a',
        ver: 2,
        modifiedAt: 2,
        status: PeerStatus.ACTIVE,
      },
      {
        uuid: legacyUuid,
        id: 'host-a',
        ver: 1,
        modifiedAt: 1,
        status: PeerStatus.ACTIVE,
        note: 'legacy note',
      },
    ]);

    await runMigration();

    const peers = await dataSource.getRepository(Peer).find();
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({
      uuid: canonicalUuid,
      note: 'legacy note',
      ver: 2,
    });
  });

  it('rewrites a case-only UUID difference in place without losing the row', async () => {
    const upperUuid = canonicalUuid.toUpperCase();
    await dataSource.getRepository(Peer).save({
      uuid: upperUuid,
      id: 'host-case',
      ver: 1,
      modifiedAt: 0,
      status: PeerStatus.ACTIVE,
      note: 'case note',
    });
    await dataSource.getRepository(Sysinfo).save({
      uuid: upperUuid,
      hostname: 'host-case',
    });

    await runMigration();

    const peers = await dataSource.getRepository(Peer).find();
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({
      uuid: canonicalUuid,
      note: 'case note',
    });
    expect(await dataSource.getRepository(Sysinfo).findOneBy({})).toMatchObject(
      { uuid: canonicalUuid },
    );
  });

  it('normalises address_book_peers.deviceId', async () => {
    const addressBook = await dataSource.getRepository(AddressBook).save({
      guid: 'ab-1',
      owner: 'user-1',
      name: 'test-book',
    });
    await dataSource.getRepository(AddressBookPeer).save({
      guid: 'abp-1',
      addressBookGuid: addressBook.guid,
      deviceId: legacyUuid,
      alias: 'device-alias',
    });

    await runMigration();

    const abp = await dataSource.getRepository(AddressBookPeer).findOneBy({
      guid: 'abp-1',
    });
    expect(abp).toMatchObject({ deviceId: canonicalUuid });
  });

  it('deduplicates address_book_peers when canonical deviceId collides', async () => {
    const addressBook = await dataSource.getRepository(AddressBook).save({
      guid: 'ab-2',
      owner: 'user-2',
      name: 'test-book-2',
    });
    await dataSource.getRepository(AddressBookPeer).save([
      {
        guid: 'abp-legacy',
        addressBookGuid: addressBook.guid,
        deviceId: legacyUuid,
        alias: 'legacy-alias',
      },
      {
        guid: 'abp-canonical',
        addressBookGuid: addressBook.guid,
        deviceId: canonicalUuid,
        alias: 'canonical-alias',
      },
    ]);

    await runMigration();

    const peers = await dataSource
      .getRepository(AddressBookPeer)
      .findBy({ addressBookGuid: addressBook.guid });
    expect(peers).toHaveLength(1);
    expect(peers[0].deviceId).toBe(canonicalUuid);
  });

  it('preserves idReleased when merging tombstones', async () => {
    await dataSource.getRepository(DeviceTombstone).save([
      {
        uuid: legacyUuid,
        deviceId: 'host-a',
        idReleased: true,
      },
      {
        uuid: canonicalUuid,
        deviceId: 'host-a',
        idReleased: false,
      },
    ]);

    await runMigration();

    const tombstones = await dataSource.getRepository(DeviceTombstone).find();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({
      uuid: canonicalUuid,
      idReleased: true,
    });
  });
});
