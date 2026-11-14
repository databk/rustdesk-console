import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from '../../database/entities';
import { Peer, Sysinfo } from '../../common/entities';
import { User } from '../user/entities/user.entity';
import { DeviceGroup } from './entities/device-group.entity';
import { applyPeerSort } from './peer-sort';

describe('peer sort sql', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: DATABASE_ENTITIES,
      synchronize: true,
    });
    await dataSource.initialize();

    await dataSource.getRepository(DeviceGroup).save([
      { guid: 'g1', name: 'Bravo' },
      { guid: 'g2', name: 'Alpha' },
    ]);
    await dataSource.getRepository(User).save([
      { guid: 'user-z', username: 'zoe' },
      { guid: 'user-a', username: 'adam' },
    ]);
    await dataSource
      .getRepository(Sysinfo)
      .save([
        { uuid: 'uuid-1', hostname: 'Zulu-box' },
        { uuid: 'uuid-2', hostname: 'Alpha-box' },
        { uuid: 'uuid-3' },
      ]);
    await dataSource.getRepository(Peer).save([
      {
        uuid: 'uuid-1',
        id: '300',
        userGuid: 'user-z',
        deviceGroupGuid: 'g1',
        status: 1,
        ver: 1,
        modifiedAt: 1,
        note: 'ccc',
      },
      {
        uuid: 'uuid-2',
        id: '100',
        userGuid: 'user-a',
        deviceGroupGuid: 'g2',
        status: 1,
        ver: 1,
        modifiedAt: 1,
        note: 'aaa',
      },
      {
        uuid: 'uuid-3',
        id: '200',
        userGuid: null,
        deviceGroupGuid: null,
        status: 1,
        ver: 1,
        modifiedAt: 1,
        note: null,
      },
    ]);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  async function sortedIds(
    sortBy: Parameters<typeof applyPeerSort>[1],
    sortOrder: Parameters<typeof applyPeerSort>[2],
  ) {
    const queryBuilder = dataSource
      .getRepository(Peer)
      .createQueryBuilder('peer')
      .leftJoin('peer.deviceGroup', 'dg')
      .select(['peer.id', 'peer.uuid', 'peer.note', 'peer.status', 'dg.name']);
    applyPeerSort(queryBuilder, sortBy, sortOrder, 'dg');
    const [peers, total] = await queryBuilder
      .skip(0)
      .take(10)
      .getManyAndCount();
    expect(total).toBe(3);
    return peers.map((peer) => peer.id);
  }

  it('sorts by every whitelisted field', async () => {
    // Devices without a related value (group, user, sysinfo, note) sort first
    // in ascending order, matching the database default.
    expect(await sortedIds('id', 'desc')).toEqual(['300', '200', '100']);
    expect(await sortedIds('device_name', 'asc')).toEqual([
      '200',
      '100',
      '300',
    ]);
    expect(await sortedIds('user_name', 'asc')).toEqual(['200', '100', '300']);
    expect(await sortedIds('device_group_name', 'asc')).toEqual([
      '200',
      '100',
      '300',
    ]);
    expect(await sortedIds('note', 'asc')).toEqual(['200', '100', '300']);
    // All devices share the same status, so the ID tie-breaker decides.
    expect(await sortedIds('status', 'desc')).toEqual(['100', '200', '300']);
  });

  it('preserves entity hydration for whole-entity peer queries', async () => {
    async function wholeEntities(
      sortBy: Parameters<typeof applyPeerSort>[1],
      sortOrder: Parameters<typeof applyPeerSort>[2],
    ) {
      const queryBuilder = dataSource
        .getRepository(Peer)
        .createQueryBuilder('peer')
        .leftJoinAndSelect('peer.deviceGroup', 'deviceGroup');
      applyPeerSort(queryBuilder, sortBy, sortOrder, 'deviceGroup');
      return queryBuilder.skip(0).take(10).getMany();
    }

    for (const sortBy of [
      'id',
      'device_name',
      'user_name',
      'device_group_name',
      'status',
      'note',
    ] as const) {
      const peers = await wholeEntities(sortBy, 'asc');

      expect(peers).toHaveLength(3);
      for (const peer of peers) {
        expect(peer.status).toBe(1);
        expect(peer.id).toBeTruthy();
      }
      expect(peers.map((peer) => peer.note)).toEqual(
        expect.arrayContaining(['aaa', 'ccc', null]),
      );
      expect(peers.map((peer) => peer.deviceGroup?.name ?? null)).toEqual(
        expect.arrayContaining(['Alpha', 'Bravo', null]),
      );
    }
  });
});
