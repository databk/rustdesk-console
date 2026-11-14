jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));

import { PeerStatus } from '../../common/entities/peer.entity';
import type { Repository } from 'typeorm';
import type { Peer } from '../../common/entities/peer.entity';
import { isolatedDeviceUuid } from '../../common/utils/device-identity.util';
import { DevicePresenceService } from './device-presence.service';
import type {
  HbbsPeerSnapshot,
  HbbsPeerSnapshotEntry,
} from '../server-management/server-management.service';
import type { ServerManagementService } from '../server-management/server-management.service';

const uuidBytes = (value: string) => Buffer.from(value).toString('base64');
// Clone isolation stores this Console-only key instead of the client UUID.
const isolatedHostB = isolatedDeviceUuid('uuid-host-b', 'host-b');

const entry = (
  overrides: Partial<HbbsPeerSnapshotEntry> & Pick<HbbsPeerSnapshotEntry, 'id'>,
): HbbsPeerSnapshotEntry => ({
  uuid: uuidBytes(`uuid-${overrides.id}`),
  address: `${overrides.id}:21118`,
  ip: `192.0.2.${overrides.id.length}`,
  online: true,
  banned: false,
  last_registration_age_seconds: 2,
  ...overrides,
});

const snapshot: HbbsPeerSnapshot = {
  available: true,
  checked_at: '2026-11-13T00:00:00.000Z',
  peers: [
    entry({ id: 'host-a', ip: '203.0.113.5', online: true }),
    entry({
      id: 'host-b',
      ip: '203.0.113.6',
      online: false,
      last_registration_age_seconds: 100,
    }),
    entry({ id: 'orphan', ip: '203.0.113.7', online: true }),
  ],
};

const now = new Date('2026-11-13T00:00:00.000Z');
const onlineAfter = new Date(now.getTime() - 60_000);

const peer = (overrides: Partial<Peer> & Pick<Peer, 'uuid' | 'id'>): Peer =>
  ({
    status: PeerStatus.ACTIVE,
    lastHeartbeat: now,
    ...overrides,
  }) as Peer;

describe('device presence comparison', () => {
  const create = (peerSnapshot: HbbsPeerSnapshot = snapshot) => {
    const peerRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const serverManagement = {
      getPeerSnapshot: jest.fn().mockResolvedValue(peerSnapshot),
    };
    return {
      service: new DevicePresenceService(
        peerRepository as unknown as Repository<Peer>,
        serverManagement as unknown as ServerManagementService,
      ),
      peerRepository,
      serverManagement,
    };
  };

  it('fills the IP and explains a heartbeat missing from Console', async () => {
    const { service } = create();
    const peers = [
      peer({
        uuid: 'uuid-host-a',
        id: 'host-a',
        lastHeartbeat: new Date(now.getTime() - 120_000),
      }),
      peer({ uuid: isolatedHostB, id: 'host-b' }),
      peer({ uuid: 'uuid-host-c', id: 'host-c' }),
      peer({
        uuid: 'uuid-host-d',
        id: 'host-d',
        status: PeerStatus.DISABLED,
        lastHeartbeat: now,
      }),
    ];

    const result = await service.enrich(peers, onlineAfter);

    expect(result.available).toBe(true);
    expect(result.byUuid.get('uuid-host-a')).toMatchObject({
      registered: true,
      online: true,
      ip: '203.0.113.5',
      anomaly: 'hbbs_online_console_offline',
    });
    // Clone isolation stores a derived Console key; it is verified against the
    // hbbs UUID and ID, so it still attaches the registration address.
    expect(result.byUuid.get(isolatedHostB)).toMatchObject({
      registered: true,
      online: false,
      ip: '203.0.113.6',
      anomaly: 'console_online_hbbs_offline',
    });
    expect(result.byUuid.get('uuid-host-c')).toMatchObject({
      registered: false,
      ip: '',
      anomaly: 'console_online_hbbs_offline',
    });
    // Disabled devices are intentionally absent from the admission layer.
    expect(result.byUuid.get('uuid-host-d')?.anomaly).toBeNull();
  });

  it('reports deployment-wide mismatches only when requested', async () => {
    const { service, peerRepository } = create();
    const peers = [
      peer({
        uuid: 'uuid-host-a',
        id: 'host-a',
        lastHeartbeat: new Date(now.getTime() - 120_000),
      }),
      peer({ uuid: isolatedHostB, id: 'host-b' }),
      peer({ uuid: 'uuid-host-c', id: 'host-c' }),
      peer({
        uuid: 'uuid-host-d',
        id: 'host-d',
        status: PeerStatus.DISABLED,
        lastHeartbeat: new Date(now.getTime() - 120_000),
      }),
    ];
    peerRepository.find.mockResolvedValue(peers);

    const result = await service.enrich(peers, onlineAfter, true);

    expect(result.report).toMatchObject({
      available: true,
      checked_at: snapshot.checked_at,
      hbbs: { registered: 3, online: 2 },
      console: { total: 4, online: 2 },
      mismatches: {
        hbbs_online_console_offline: {
          count: 1,
          device_ids: ['host-a'],
        },
        console_online_hbbs_offline: {
          count: 2,
          device_ids: ['host-b', 'host-c'],
        },
        hbbs_only: { count: 1, device_ids: ['orphan'] },
      },
      anomaly_count: 4,
    });
    expect(peerRepository.find).toHaveBeenCalledTimes(1);
  });

  it('does not attach a shared RustDesk ID to another device', async () => {
    const { service } = create();
    const peers = [
      peer({ uuid: isolatedHostB, id: 'host-b' }),
      // Same RustDesk ID, different client UUID: the hbbs registration for
      // host-b must stay unassigned instead of leaking its address.
      peer({ uuid: 'uuid-someone-else', id: 'host-b' }),
    ];

    const result = await service.enrich(peers, onlineAfter);

    expect(result.byUuid.get(isolatedHostB)).toMatchObject({
      registered: true,
      ip: '203.0.113.6',
    });
    expect(result.byUuid.get('uuid-someone-else')).toMatchObject({
      registered: false,
      ip: '',
      anomaly: 'console_online_hbbs_offline',
    });
  });

  it('tracks report heartbeats per Console row when IDs collide', async () => {
    const { service, peerRepository } = create();
    const peers = [
      peer({
        uuid: 'uuid-host-a',
        id: 'host-a',
        lastHeartbeat: new Date(now.getTime() - 120_000),
      }),
      // A second row with the same RustDesk ID must not make the stale row
      // look online through the shared ID.
      peer({ uuid: 'uuid-clone', id: 'host-a', lastHeartbeat: now }),
    ];
    peerRepository.find.mockResolvedValue(peers);

    const result = await service.enrich(peers, onlineAfter, true);

    expect(result.report).toMatchObject({
      console: { online: 1 },
      mismatches: {
        hbbs_online_console_offline: { count: 1, device_ids: ['host-a'] },
        console_online_hbbs_offline: { count: 1, device_ids: ['host-a'] },
        hbbs_only: { count: 1, device_ids: ['orphan'] },
      },
    });
  });

  it('does not compare when server management is unavailable', async () => {
    const { service, peerRepository } = create({
      available: false,
      reason: 'not_configured',
      checked_at: snapshot.checked_at,
      peers: [],
    });

    const result = await service.enrich(
      [peer({ uuid: 'uuid-host-a', id: 'host-a' })],
      onlineAfter,
      true,
    );

    expect(result).toMatchObject({
      available: false,
      reason: 'not_configured',
      checked_at: snapshot.checked_at,
      byUuid: new Map(),
    });
    expect(result.report).toBeUndefined();
    expect(peerRepository.find).not.toHaveBeenCalled();
  });
});
