import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from '../database/entities';
import { Peer, PeerStatus, Sysinfo } from '../common/entities';
import { ActiveConnection } from '../modules/heartbeat/entities/active-connection.entity';
import { DeviceTombstone } from '../modules/device-group/entities/device-tombstone.entity';
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
});
