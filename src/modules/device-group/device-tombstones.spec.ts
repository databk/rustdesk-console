import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DeviceGroupService } from './device-group.service';
import { DeviceTombstone } from './entities/device-tombstone.entity';
import { HeartbeatService } from '../heartbeat/heartbeat.service';
import type { Peer } from '../../common/entities';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

const forbiddenAuthorization = (peer: Peer | null) => ({
  assertDeviceAccess: jest.fn().mockResolvedValue({
    peer,
    scope: { global: true, deviceGroupGuids: new Set() },
  }),
  // devices.delete resolves with a global scope (the tombstone endpoints
  // are usable); servers.ban rejects, so the protocol sync degrades.
  requirePermission: jest.fn((_actor: string, permission: string) =>
    permission === 'devices.delete'
      ? Promise.resolve({ global: true, deviceGroupGuids: new Set() })
      : Promise.reject(new ForbiddenException('no servers.ban permission')),
  ),
});

const allowServerBans = (authorization: Record<string, jest.Mock>) => {
  authorization.requirePermission.mockResolvedValue({
    global: true,
    deviceGroupGuids: new Set(),
  });
  return authorization;
};

const peerOf = (overrides: Partial<Peer> = {}): Peer =>
  ({
    uuid: 'device-guid',
    id: '123456789',
    deviceGroupGuid: null,
    ...overrides,
  }) as unknown as Peer;

describe('device deletion tombstones', () => {
  const createService = (options: { deleteAffected?: number } = {}) => {
    const peerRepository = {
      delete: jest
        .fn()
        .mockResolvedValue({ affected: options.deleteAffected ?? 1 }),
    };
    const deviceTombstoneRepository = {
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([
        {
          uuid: 'device-guid',
          deviceId: '123456789',
          banned: true,
          releaseRequested: true,
          idReleased: false,
          deletedBy: 'actor',
        },
      ]),
      findOne: jest.fn().mockResolvedValue({
        uuid: 'device-guid',
        deviceId: '123456789',
        banned: true,
        releaseRequested: true,
        idReleased: false,
        deletedBy: 'actor',
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const authorization = forbiddenAuthorization(peerOf());
    const serverManagement = {
      syncDeviceBans: jest.fn().mockResolvedValue({ enforced: true }),
      releaseDeviceId: jest.fn().mockResolvedValue({ enforced: true }),
    };
    const manager = {
      getRepository: jest.fn((target: unknown) =>
        target === DeviceTombstone ? deviceTombstoneRepository : peerRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn((work: (m: unknown) => unknown) => work(manager)),
    };
    const service = new DeviceGroupService(
      {} as never,
      {} as never,
      peerRepository as never,
      {} as never,
      {} as never,
      deviceTombstoneRepository as never,
      {} as never,
      dataSource as never,
      authorization as never,
      {} as never,
      serverManagement as never,
    );
    return {
      service,
      peerRepository,
      deviceTombstoneRepository,
      authorization,
      serverManagement,
    };
  };

  it('tombstones the device and bans it at the admission layer by default', async () => {
    const {
      service,
      deviceTombstoneRepository,
      serverManagement,
      authorization,
    } = createService();
    allowServerBans(authorization);

    const result = await service.deleteDevice('device-guid', 'actor');

    expect(result.message).toBe('Device deleted');
    expect(deviceTombstoneRepository.upsert).toHaveBeenCalledWith(
      { uuid: 'device-guid', deviceId: '123456789', deletedBy: 'actor' },
      ['uuid'],
    );
    expect(serverManagement.syncDeviceBans).toHaveBeenCalledWith('actor', {
      add: ['123456789'],
    });
    expect(serverManagement.releaseDeviceId).toHaveBeenCalledWith(
      'actor',
      '123456789',
    );
    expect(result.idRelease).toMatchObject({ enforced: true });
    // The freed id stays blocked by the ban until the device is restored.
    expect(result.idRelease).toMatchObject({
      detail: expect.stringContaining('until the device is restored'),
    });
    expect(deviceTombstoneRepository.update).toHaveBeenCalledWith(
      { uuid: 'device-guid' },
      { banned: true, releaseRequested: true, idReleased: true },
    );
  });

  it('keeps the tombstone when the ban cannot be applied', async () => {
    const {
      service,
      deviceTombstoneRepository,
      serverManagement,
      authorization,
    } = createService();
    allowServerBans(authorization);
    serverManagement.syncDeviceBans.mockResolvedValue({
      enforced: false,
      reason: 'upstream_error',
    });

    const result = await service.deleteDevice('device-guid', 'actor');

    expect(result.protocolEnforcement).toMatchObject({ enforced: false });
    // The ban failed but the release still succeeded; only the achieved
    // follow-ups are recorded on the tombstone.
    expect(deviceTombstoneRepository.update).toHaveBeenCalledWith(
      { uuid: 'device-guid' },
      { releaseRequested: true, idReleased: true },
    );
  });

  it('skips the protocol ban when explicitly requested', async () => {
    const { service, serverManagement } = createService();

    const result = await service.deleteDevice('device-guid', 'actor', {
      protocolBan: false,
    });

    expect(serverManagement.syncDeviceBans).not.toHaveBeenCalled();
    // Without the servers.ban permission the id release degrades too.
    expect(serverManagement.releaseDeviceId).not.toHaveBeenCalled();
    expect(result.idRelease).toMatchObject({
      enforced: false,
      reason: 'forbidden',
    });
  });

  it('skips the id release when explicitly requested', async () => {
    const {
      service,
      serverManagement,
      authorization,
      deviceTombstoneRepository,
    } = createService();
    allowServerBans(authorization);

    const result = await service.deleteDevice('device-guid', 'actor', {
      releaseId: false,
    });

    expect(serverManagement.releaseDeviceId).not.toHaveBeenCalled();
    expect(result.idRelease).toBeUndefined();
    expect(deviceTombstoneRepository.update).toHaveBeenCalledWith(
      { uuid: 'device-guid' },
      { banned: true },
    );
  });

  it('reports a failed id release without failing the deletion', async () => {
    const {
      service,
      serverManagement,
      authorization,
      deviceTombstoneRepository,
    } = createService();
    allowServerBans(authorization);
    serverManagement.releaseDeviceId.mockResolvedValue({
      enforced: false,
      reason: 'upstream_error',
    });

    const result = await service.deleteDevice('device-guid', 'actor');

    expect(result.message).toBe('Device deleted');
    expect(result.idRelease).toMatchObject({
      enforced: false,
      reason: 'upstream_error',
      detail: expect.stringContaining('remains bound'),
    });
    expect(deviceTombstoneRepository.update).toHaveBeenCalledWith(
      { uuid: 'device-guid' },
      { banned: true, releaseRequested: true },
    );
  });

  it('rejects concurrent or missing deletions', async () => {
    const { service } = createService({ deleteAffected: 0 });
    await expect(service.deleteDevice('device-guid', 'actor')).rejects.toThrow(
      ConflictException,
    );
    const missing = createService();
    missing.authorization.assertDeviceAccess.mockRejectedValue(
      new NotFoundException('Device not found'),
    );
    await expect(
      missing.service.deleteDevice('device-guid', 'actor'),
    ).rejects.toThrow(NotFoundException);
  });

  it('keeps the tombstone when the protocol ban cannot be lifted', async () => {
    const { service, deviceTombstoneRepository, serverManagement } =
      createService();
    // requirePermission rejects servers.ban by default (no permission).

    const result = await service.restoreTombstone('device-guid', 'actor');

    expect(result.message).toContain('not restored');
    expect(result.protocolEnforcement).toMatchObject({
      enforced: false,
      reason: 'forbidden',
    });
    expect(deviceTombstoneRepository.delete).not.toHaveBeenCalled();
    // The restore bails out before attempting the id release.
    expect(serverManagement.releaseDeviceId).not.toHaveBeenCalled();
  });

  it('rejects non-global delete scopes from tombstone management', async () => {
    const { service, authorization } = createService();
    authorization.requirePermission.mockImplementation((_actor, permission) =>
      permission === 'devices.delete'
        ? Promise.resolve({
            global: false,
            deviceGroupGuids: new Set(['group-1']),
          })
        : Promise.reject(new ForbiddenException('no servers.ban permission')),
    );

    await expect(service.listTombstones('actor')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.restoreTombstone('device-guid', 'actor'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lists the tombstones', async () => {
    const { service, deviceTombstoneRepository } = createService();
    const result = await service.listTombstones('actor');
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ uuid: 'device-guid' });
    expect(deviceTombstoneRepository.find).toHaveBeenCalled();
  });

  it('restores a tombstoned device and lifts its protocol ban', async () => {
    const {
      service,
      deviceTombstoneRepository,
      serverManagement,
      authorization,
    } = createService();
    allowServerBans(authorization);

    const result = await service.restoreTombstone('device-guid', 'actor');

    expect(result.message).toContain('restored');
    expect(deviceTombstoneRepository.delete).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'device-guid' }),
    );
    expect(serverManagement.syncDeviceBans).toHaveBeenCalledWith('actor', {
      remove: ['123456789'],
    });
    // The restore retries the id release (a no-op when already released).
    expect(serverManagement.releaseDeviceId).toHaveBeenCalledWith(
      'actor',
      '123456789',
    );
    expect(result.idRelease).toEqual({ enforced: true });
  });

  it('still restores when the id release fails', async () => {
    const {
      service,
      deviceTombstoneRepository,
      serverManagement,
      authorization,
    } = createService();
    allowServerBans(authorization);
    serverManagement.releaseDeviceId.mockResolvedValue({
      enforced: false,
      reason: 'upstream_error',
    });

    const result = await service.restoreTombstone('device-guid', 'actor');

    expect(result.message).toContain('restored');
    expect(deviceTombstoneRepository.delete).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'device-guid' }),
    );
    expect(result.idRelease).toMatchObject({
      enforced: false,
      reason: 'upstream_error',
    });
  });

  it('does not repeat a successful id release when restoring', async () => {
    const {
      service,
      deviceTombstoneRepository,
      serverManagement,
      authorization,
    } = createService();
    allowServerBans(authorization);
    // The deletion freed the id; a replacement machine may have claimed it
    // by now, so releasing again would destroy its binding.
    deviceTombstoneRepository.findOne.mockResolvedValue({
      uuid: 'device-guid',
      deviceId: '123456789',
      banned: true,
      releaseRequested: true,
      idReleased: true,
      deletedBy: 'actor',
    });

    const result = await service.restoreTombstone('device-guid', 'actor');

    expect(result.message).toContain('restored');
    expect(serverManagement.releaseDeviceId).not.toHaveBeenCalled();
    expect(result.idRelease).toBeUndefined();
    expect(deviceTombstoneRepository.delete).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'device-guid' }),
    );
  });

  it('never releases an id the operator opted out of releasing', async () => {
    const {
      service,
      deviceTombstoneRepository,
      serverManagement,
      authorization,
    } = createService();
    allowServerBans(authorization);
    // Deletion ran with releaseId=false; the opt-out must survive and stop
    // the restore from releasing the id after all.
    deviceTombstoneRepository.findOne.mockResolvedValue({
      uuid: 'device-guid',
      deviceId: '123456789',
      banned: true,
      releaseRequested: false,
      idReleased: false,
      deletedBy: 'actor',
    });

    const result = await service.restoreTombstone('device-guid', 'actor');

    expect(result.message).toContain('restored');
    expect(serverManagement.releaseDeviceId).not.toHaveBeenCalled();
    expect(result.idRelease).toBeUndefined();
  });

  it('fails to restore an unknown tombstone', async () => {
    const { service, deviceTombstoneRepository } = createService();
    deviceTombstoneRepository.findOne.mockResolvedValue(null);
    await expect(service.restoreTombstone('missing', 'actor')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('heartbeat tombstone guard', () => {
  const createHeartbeat = (tombstone: unknown) => {
    const peerRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockResolvedValue({}),
    };
    const disconnectStoreService = {
      removeDisconnected: jest.fn(),
      getPendingDisconnects: jest.fn().mockReturnValue([]),
    };
    const service = new HeartbeatService(
      peerRepository as never,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue(tombstone),
      } as never,
      disconnectStoreService as never,
      {} as never,
      {} as never,
    );
    return { service, peerRepository };
  };

  const heartbeat = {
    id: '123456789',
    uuid: 'device-guid',
    ver: 1,
    modified_at: 0,
  };

  it('ignores heartbeats from tombstoned devices', async () => {
    const { service, peerRepository } = createHeartbeat({
      uuid: 'device-guid',
    });
    await service.handleHeartbeat(heartbeat);
    expect(peerRepository.save).not.toHaveBeenCalled();
  });

  it('registers unknown devices without a tombstone', async () => {
    const { service, peerRepository } = createHeartbeat(null);
    await service.handleHeartbeat(heartbeat);
    expect(peerRepository.save).toHaveBeenCalled();
  });
});
