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

// RustDesk clients send `encode64(rawUuidBytes)` to the Console API, and hbbs
// reports `base64::encode(rawUuidBytes)`, so both sources carry this text.
const clientUuid = (value: string) => Buffer.from(value).toString('base64');
// Clone isolation stores this Console-only key instead of the client UUID.
const isolatedHostB = isolatedDeviceUuid(clientUuid('uuid-host-b'), 'host-b');

const entry = (
  overrides: Partial<HbbsPeerSnapshotEntry> & Pick<HbbsPeerSnapshotEntry, 'id'>,
): HbbsPeerSnapshotEntry => ({
  uuid: clientUuid(`uuid-${overrides.id}`),
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
        uuid: clientUuid('uuid-host-a'),
        id: 'host-a',
        lastHeartbeat: new Date(now.getTime() - 120_000),
      }),
      peer({ uuid: isolatedHostB, id: 'host-b' }),
      peer({ uuid: clientUuid('uuid-host-c'), id: 'host-c' }),
      peer({
        uuid: clientUuid('uuid-host-d'),
        id: 'host-d',
        status: PeerStatus.DISABLED,
        lastHeartbeat: now,
      }),
    ];

    const result = await service.enrich(peers, onlineAfter);

    expect(result.available).toBe(true);
    expect(result.byUuid.get(clientUuid('uuid-host-a'))).toMatchObject({
      registered: true,
      online: true,
      ip: '203.0.113.5',
      anomaly: 'hbbs_online_console_offline',
    });
    // Clone isolation stores a derived Console key; it is verified against the
    // client UUID and ID, so it still attaches the registration address.
    expect(result.byUuid.get(isolatedHostB)).toMatchObject({
      registered: true,
      online: false,
      ip: '203.0.113.6',
      anomaly: 'console_online_hbbs_offline',
    });
    expect(result.byUuid.get(clientUuid('uuid-host-c'))).toMatchObject({
      registered: false,
      ip: '',
      anomaly: 'console_online_hbbs_offline',
    });
    // Disabled devices are intentionally absent from the admission layer.
    expect(result.byUuid.get(clientUuid('uuid-host-d'))?.anomaly).toBeNull();
  });

  it('reports deployment-wide mismatches only when requested', async () => {
    const { service, peerRepository } = create();
    const peers = [
      peer({
        uuid: clientUuid('uuid-host-a'),
        id: 'host-a',
        lastHeartbeat: new Date(now.getTime() - 120_000),
      }),
      peer({ uuid: isolatedHostB, id: 'host-b' }),
      peer({ uuid: clientUuid('uuid-host-c'), id: 'host-c' }),
      peer({
        uuid: clientUuid('uuid-host-d'),
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
    const otherUuid = clientUuid('uuid-someone-else');
    const peers = [
      peer({ uuid: isolatedHostB, id: 'host-b' }),
      // Same RustDesk ID, different client UUID: the hbbs registration for
      // host-b must stay unassigned instead of leaking its address.
      peer({ uuid: otherUuid, id: 'host-b' }),
    ];

    const result = await service.enrich(peers, onlineAfter);

    expect(result.byUuid.get(isolatedHostB)).toMatchObject({
      registered: true,
      ip: '203.0.113.6',
    });
    expect(result.byUuid.get(otherUuid)).toMatchObject({
      registered: false,
      ip: '',
      anomaly: 'console_online_hbbs_offline',
    });
  });

  it('matches legacy rows by UUID and ID when clones share a UUID', async () => {
    const sharedUuid = clientUuid('uuid-shared');
    const { service } = create({
      available: true,
      checked_at: snapshot.checked_at,
      peers: [
        entry({ id: 'host-a', uuid: sharedUuid, ip: '203.0.113.10' }),
        entry({ id: 'host-b', uuid: sharedUuid, ip: '203.0.113.11' }),
      ],
    });
    const cloneKey = isolatedDeviceUuid(sharedUuid, 'host-b');
    const peers = [
      peer({ uuid: sharedUuid, id: 'host-a' }),
      peer({ uuid: cloneKey, id: 'host-b' }),
    ];

    const result = await service.enrich(peers, onlineAfter);

    // The legacy row must keep its own registration instead of the last hbbs
    // entry that happens to share the clone UUID.
    expect(result.byUuid.get(sharedUuid)).toMatchObject({
      registered: true,
      ip: '203.0.113.10',
    });
    expect(result.byUuid.get(cloneKey)).toMatchObject({
      registered: true,
      ip: '203.0.113.11',
    });
  });

  it('matches the base64 UUID that clients actually send', async () => {
    // Mobile clients derive the UUID from random bytes, so the base64 text
    // does not decode to a printable string. Console and hbbs still carry the
    // same text, which is what the presence index must compare.
    const sharedUuid = Buffer.from([
      0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60,
      0x70, 0x90, 0xa0, 0xb0,
    ]).toString('base64');
    expect(Buffer.from(sharedUuid, 'base64').toString('utf8')).not.toMatch(
      /^[\x20-\x7e]+$/,
    );
    const cloneKey = isolatedDeviceUuid(sharedUuid, 'host-b');
    const { service, peerRepository } = create({
      available: true,
      checked_at: snapshot.checked_at,
      peers: [
        entry({ id: 'host-a', uuid: sharedUuid, ip: '203.0.113.20' }),
        entry({ id: 'host-b', uuid: sharedUuid, ip: '203.0.113.21' }),
      ],
    });
    const peers = [
      peer({ uuid: sharedUuid, id: 'host-a' }),
      peer({ uuid: cloneKey, id: 'host-b' }),
    ];
    peerRepository.find.mockResolvedValue(peers);

    const result = await service.enrich(peers, onlineAfter, true);

    // Both the legacy and the clone-isolated lookup must attach the right
    // registration instead of dropping the non-printable UUID.
    expect(result.byUuid.get(sharedUuid)).toMatchObject({
      registered: true,
      online: true,
      ip: '203.0.113.20',
    });
    expect(result.byUuid.get(cloneKey)).toMatchObject({
      registered: true,
      online: true,
      ip: '203.0.113.21',
    });
    expect(result.report?.anomaly_count).toBe(0);
  });

  it('tracks report heartbeats per Console row when IDs collide', async () => {
    const { service, peerRepository } = create();
    const peers = [
      peer({
        uuid: clientUuid('uuid-host-a'),
        id: 'host-a',
        lastHeartbeat: new Date(now.getTime() - 120_000),
      }),
      // A second row with the same RustDesk ID must not make the stale row
      // look online through the shared ID.
      peer({
        uuid: clientUuid('uuid-clone'),
        id: 'host-a',
        lastHeartbeat: now,
      }),
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

  it('matches a canonical Console UUID to the base64 UUID that hbbs reports', async () => {
    const canonical = '550e8400-e29b-41d4-a716-446655440000';
    const hbbsUuid = Buffer.from(canonical.replace(/-/g, ''), 'hex').toString(
      'base64',
    );
    const { service } = create({
      available: true,
      checked_at: snapshot.checked_at,
      peers: [entry({ id: 'host-a', uuid: hbbsUuid, ip: '203.0.113.30' })],
    });

    const result = await service.enrich(
      [peer({ uuid: canonical, id: 'host-a' })],
      onlineAfter,
    );

    expect(result.byUuid.get(canonical)).toMatchObject({
      registered: true,
      online: true,
      ip: '203.0.113.30',
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
      [peer({ uuid: clientUuid('uuid-host-a'), id: 'host-a' })],
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
