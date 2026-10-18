import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DeviceGroupService } from './device-group.service';
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
  requirePermission: jest
    .fn()
    .mockRejectedValue(new ForbiddenException('no servers.ban permission')),
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
          deletedBy: 'actor',
        },
      ]),
      findOne: jest.fn().mockResolvedValue({
        uuid: 'device-guid',
        deviceId: '123456789',
        banned: true,
        deletedBy: 'actor',
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const authorization = forbiddenAuthorization(peerOf());
    const serverManagement = {
      syncDeviceBans: jest.fn().mockResolvedValue({ enforced: true }),
    };
    const service = new DeviceGroupService(
      {} as never,
      {} as never,
      peerRepository as never,
      {} as never,
      {} as never,
      deviceTombstoneRepository as never,
      {} as never,
      {} as never,
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
    expect(deviceTombstoneRepository.update).toHaveBeenCalledWith(
      { uuid: 'device-guid' },
      { banned: true },
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
    expect(deviceTombstoneRepository.update).not.toHaveBeenCalled();
  });

  it('skips the protocol ban when explicitly requested', async () => {
    const { service, serverManagement } = createService();

    await service.deleteDevice('device-guid', 'actor', {
      protocolBan: false,
    });

    expect(serverManagement.syncDeviceBans).not.toHaveBeenCalled();
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

  it('lists the tombstones', async () => {
    const { service, deviceTombstoneRepository } = createService();
    const result = await service.listTombstones();
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
