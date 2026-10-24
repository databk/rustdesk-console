import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from '../../database/entities';
import { Peer, Sysinfo } from '../entities';
import { isolatedDeviceUuid } from './device-identity.util';
import { HeartbeatService } from '../../modules/heartbeat/heartbeat.service';
import { HeartbeatCacheService } from '../../modules/heartbeat/services/heartbeat-cache.service';
import { DisconnectStoreService } from '../../modules/heartbeat/services/disconnect-store.service';
import { ActiveConnection } from '../../modules/heartbeat/entities/active-connection.entity';
import { DeviceTombstone } from '../../modules/device-group/entities/device-tombstone.entity';
import { StrategyService } from '../../modules/strategy/strategy.service';
import { SysinfoService } from '../../modules/sysinfo/sysinfo.service';
import { AuthDeviceService } from '../../modules/auth/services/auth-device.service';
import { AddressBookPeerService } from '../../modules/address-book/services/address-book-peer.service';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookTag,
  AddressBookPeerTag,
} from '../../modules/address-book/entities';
import { DeviceGroup } from '../../modules/device-group/entities/device-group.entity';
import { AuditService } from '../../modules/audit/audit.service';
import { ConnectionAudit } from '../../modules/audit/entities/connection-audit.entity';
import { FileAudit } from '../../modules/audit/entities/file-audit.entity';
import { AlarmAudit } from '../../modules/audit/entities/alarm-audit.entity';
import { RbacAuditService } from '../../modules/rbac/services/rbac-audit.service';
import { RbacAuthorizationService } from '../../modules/rbac/services/rbac-authorization.service';

jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));

describe('cloned client isolation (SQLite)', () => {
  let db: DataSource;
  let heartbeat: HeartbeatService;
  let cache: HeartbeatCacheService;
  let sysinfo: SysinfoService;
  let auth: AuthDeviceService;
  let addressBook: AddressBookPeerService;
  let disconnects: DisconnectStoreService;
  let audit: AuditService;
  const uuid = 'shared-machine-guid';
  const a = '130373089';
  const b = '513712190';
  const previousFlag = process.env.DEVICE_CLONE_ISOLATION;
  const report = (id: string, conns: number[] = []) => ({
    id,
    uuid,
    ver: 1,
    modified_at: 0,
    conns,
  });

  beforeEach(async () => {
    process.env.DEVICE_CLONE_ISOLATION = 'true';
    db = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: DATABASE_ENTITIES,
      synchronize: true,
    });
    await db.initialize();
    const repo = <T extends import('typeorm').ObjectLiteral>(
      entity: import('typeorm').EntityTarget<T>,
    ) => db.getRepository(entity);
    cache = new HeartbeatCacheService(db);
    disconnects = new DisconnectStoreService();
    heartbeat = new HeartbeatService(
      repo(Peer),
      repo(ActiveConnection),
      repo(DeviceTombstone),
      disconnects,
      {
        findStrategyForPeer: jest.fn().mockResolvedValue(null),
      } as unknown as StrategyService,
      cache,
    );
    sysinfo = new SysinfoService(
      repo(Sysinfo),
      repo(AddressBook),
      repo(AddressBookPeer),
      repo(AddressBookTag),
      repo(DeviceGroup),
      repo(Peer),
    );
    auth = new AuthDeviceService(repo(Peer));
    addressBook = new AddressBookPeerService(
      repo(AddressBook),
      repo(AddressBookPeer),
      repo(AddressBookPeerTag),
      repo(Sysinfo),
      repo(Peer),
    );
    audit = new AuditService(
      repo(ConnectionAudit),
      repo(FileAudit),
      repo(AlarmAudit),
      repo(ActiveConnection),
      repo(Peer),
      {} as RbacAuditService,
      {} as RbacAuthorizationService,
    );
  });

  afterEach(async () => {
    await db.destroy();
    if (previousFlag === undefined) delete process.env.DEVICE_CLONE_ISOLATION;
    else process.env.DEVICE_CLONE_ISOLATION = previousFlag;
  });

  it('keeps two fresh clones separate across interleaved heartbeats and sysinfo', async () => {
    await Promise.all([
      heartbeat.handleHeartbeat(report(a, [7])),
      heartbeat.handleHeartbeat(report(b, [7])),
    ]);
    for (const id of [b, a, b, a])
      await heartbeat.handleHeartbeat(report(id, [7]));
    await cache.flush();
    expect(await db.getRepository(Peer).count()).toBe(2);
    for (const id of [a, b]) {
      const key = isolatedDeviceUuid(uuid, id);
      expect(
        await db.getRepository(Peer).findOneByOrFail({ uuid: key }),
      ).toMatchObject({ id });
      expect(
        await sysinfo.createSysinfo({
          uuid,
          id,
          hostname: 'SAME-NAME',
          cpu: id,
        }),
      ).toMatchObject({ found: true });
      expect(
        await db.getRepository(Sysinfo).findOneByOrFail({ uuid: key }),
      ).toMatchObject({ cpu: id });
      expect(await heartbeat.getActiveConnectionIds(key)).toEqual([7]);
    }
    expect(await db.getRepository(ActiveConnection).count()).toBe(2);
  });

  it('preserves the legacy peer and its address book while adding the clone', async () => {
    await db
      .getRepository(Peer)
      .save({ uuid, id: a, ver: 1, modifiedAt: 0, note: 'keep' });
    await db
      .getRepository(AddressBook)
      .save({ guid: 'book', name: 'Test', owner: 'owner' });
    await addressBook.addPeer('book', { id: a, alias: 'A' });
    await heartbeat.handleHeartbeat(report(b));
    await heartbeat.handleHeartbeat(report(a));
    await cache.flush();
    await addressBook.addPeer('book', { id: b, alias: 'B' });
    const result = await addressBook.getPeers({ ab: 'book' });
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: a, alias: 'A' }),
        expect.objectContaining({ id: b, alias: 'B' }),
      ]),
    );
    expect(
      await db.getRepository(Peer).findOneByOrFail({ uuid }),
    ).toMatchObject({ id: a, note: 'keep' });
    await expect(addressBook.addPeer('book', { id: b })).rejects.toThrow(
      'Device already exists',
    );
  });

  it('does not recreate a deleted isolated device or affect the other clone', async () => {
    await heartbeat.handleHeartbeat(report(a));
    const key = isolatedDeviceUuid(uuid, a);
    await db.getRepository(DeviceTombstone).save({ uuid: key, deviceId: a });
    await db.getRepository(Peer).delete({ uuid: key });
    await heartbeat.handleHeartbeat(report(a));
    await heartbeat.handleHeartbeat(report(b));
    expect(await db.getRepository(Peer).findOneBy({ uuid: key })).toBeNull();
    expect(await db.getRepository(Peer).count()).toBe(1);
  });

  it('honors pre-isolation tombstones without blocking a different ID', async () => {
    await db.getRepository(DeviceTombstone).save({ uuid, deviceId: a });
    await heartbeat.handleHeartbeat(report(a));
    await heartbeat.handleHeartbeat(report(b));
    expect(await db.getRepository(Peer).count()).toBe(1);
    expect(await db.getRepository(Peer).findOneBy({ id: a })).toBeNull();
  });

  it('does not route a clone disconnect request to the other clone', async () => {
    await heartbeat.handleHeartbeat(report(a, [7]));
    await heartbeat.handleHeartbeat(report(b, [7]));
    disconnects.addPendingDisconnects(isolatedDeviceUuid(uuid, b), [7]);
    expect(await heartbeat.handleHeartbeat(report(a, [7]))).toEqual({});
    expect(await heartbeat.handleHeartbeat(report(b, [7]))).toEqual({
      disconnect: [7],
    });
  });

  it('binds and logs out only the requested clone, ignoring UUID-only requests', async () => {
    await heartbeat.handleHeartbeat(report(a));
    await heartbeat.handleHeartbeat(report(b));
    await auth.createOrUpdateDevice('user-a', a, uuid);
    await auth.createOrUpdateDevice('user-b', b, uuid);
    await auth.unbindDevice('user-a', uuid, a);
    await auth.unbindDevice('user-b', uuid);
    await auth.createOrUpdateDevice('wrong', undefined, uuid);
    expect(
      await db.getRepository(Peer).findOneByOrFail({ id: a }),
    ).toMatchObject({ userGuid: null });
    expect(
      await db.getRepository(Peer).findOneByOrFail({ id: b }),
    ).toMatchObject({ userGuid: 'user-b' });
  });

  it('does not overwrite sysinfo when ID is missing or not yet registered', async () => {
    await heartbeat.handleHeartbeat(report(a));
    expect(
      await sysinfo.createSysinfo({ uuid, hostname: 'ambiguous' }),
    ).toEqual({ found: false });
    expect(await sysinfo.createSysinfo({ uuid, id: b })).toEqual({
      found: false,
    });
    expect(await db.getRepository(Sysinfo).count()).toBe(0);
  });

  it('uses isolated device keys for connection audit correlation', async () => {
    await heartbeat.handleHeartbeat(report(a));
    await heartbeat.handleHeartbeat(report(b));
    for (const id of [a, b]) {
      const row = await audit.auditConnection({
        id,
        uuid,
        conn_id: 7,
        session_id: 1,
        action: 'open',
      });
      expect(row.deviceUuid).toBe(isolatedDeviceUuid(uuid, id));
    }
    expect(await db.getRepository(ConnectionAudit).count()).toBe(2);
  });

  it('applies address-book presets to each clone independently', async () => {
    await db
      .getRepository(AddressBook)
      .save({ guid: 'preset-book', owner: 'owner', name: 'Clones' });
    for (const id of [a, b]) {
      await heartbeat.handleHeartbeat(report(id));
      await sysinfo.createSysinfo({
        uuid,
        id,
        hostname: 'SAME-NAME',
        'preset-address-book-name': 'Clones',
        'preset-address-book-alias': id,
      });
    }
    const result = await addressBook.getPeers({ ab: 'preset-book' });
    expect(result.total).toBe(2);
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: a, alias: a }),
        expect.objectContaining({ id: b, alias: b }),
      ]),
    );
  });

  it('treats a changed numeric ID as a new device and keeps the old entry', async () => {
    await heartbeat.handleHeartbeat(report(a));
    await heartbeat.handleHeartbeat(report('999999999'));
    await cache.flush();
    expect(await db.getRepository(Peer).count()).toBe(2);
    expect(
      await db
        .getRepository(Peer)
        .findOneByOrFail({ uuid: isolatedDeviceUuid(uuid, a) }),
    ).toMatchObject({ id: a });
  });

  it('retains legacy behavior when the flag is disabled', async () => {
    delete process.env.DEVICE_CLONE_ISOLATION;
    await heartbeat.handleHeartbeat(report(a));
    await heartbeat.handleHeartbeat(report(b));
    await cache.flush();
    expect(await db.getRepository(Peer).count()).toBe(1);
    expect(
      await db.getRepository(Peer).findOneByOrFail({ uuid }),
    ).toMatchObject({ id: b });
  });
});
