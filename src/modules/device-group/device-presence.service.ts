import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { isolatedDeviceUuid } from '../../common/utils/device-identity.util';
import {
  HbbsPeerSnapshot,
  HbbsPeerSnapshotEntry,
  ServerManagementService,
} from '../server-management/server-management.service';

export type DevicePresenceAnomaly =
  'hbbs_online_console_offline' | 'console_online_hbbs_offline';

export interface DevicePresenceView {
  /** Whether hbbs currently has a registry entry for this device. */
  registered: boolean;
  /** Registration freshness reported by hbbs (30 second window). */
  online: boolean;
  ip: string;
  address: string | null;
  last_registration_age_seconds: number | null;
  banned: boolean;
  /**
   * Presence disagreement between the two independent sources. Console
   * heartbeat state remains authoritative for `is_online`.
   */
  anomaly: DevicePresenceAnomaly | null;
}

export interface DevicePresenceMismatch {
  count: number;
  device_ids: string[];
}

export interface DevicePresenceReport {
  available: boolean;
  reason?: 'not_configured' | 'upstream_error';
  checked_at: string;
  hbbs: { registered: number; online: number };
  console: { total: number; online: number };
  mismatches: {
    /** Registered at hbbs, but no Console heartbeat for an active device. */
    hbbs_online_console_offline: DevicePresenceMismatch;
    /** Sent a Console heartbeat, but is not currently registered at hbbs. */
    console_online_hbbs_offline: DevicePresenceMismatch;
    /** Online at hbbs but absent from the Console inventory entirely. */
    hbbs_only: DevicePresenceMismatch;
  };
  anomaly_count: number;
}

export interface DevicePresenceEnrichment {
  available: boolean;
  reason?: 'not_configured' | 'upstream_error';
  checked_at: string;
  /** Presence views keyed by the Console peer UUID. */
  byUuid: Map<string, DevicePresenceView>;
  /** Present only when the caller asked for a deployment-wide comparison. */
  report?: DevicePresenceReport;
}

type PresencePeer = Pick<Peer, 'uuid' | 'id' | 'status' | 'lastHeartbeat'>;

interface PeerIndex {
  byUuid: Map<string, HbbsPeerSnapshotEntry>;
  /**
   * Clone-isolation keys derived from the hbbs UUID and RustDesk ID. Indexing
   * the derived key keeps the match exact, so a shared RustDesk ID can never
   * attach another device's registration.
   */
  byIsolatedUuid: Map<string, HbbsPeerSnapshotEntry>;
}

// hbbs reports the client UUID as base64-encoded bytes. A Console UUID is a
// printable string, so only use the decoded value when it round-trips as one;
// clone-isolation keys are derived separately from the decoded value.
function decodeHbbsUuid(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return /^[\x20-\x7e]+$/.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Compares the hbbs peer registry with the heartbeat-backed Console inventory.
 *
 * The two sources are deliberately kept independent: hbbs knows who is
 * registered for remote connections, while Console knows which clients reached
 * the API. This service only enriches listings and reports disagreements; it
 * never rewrites `is_online` or creates/deletes devices.
 */
@Injectable()
export class DevicePresenceService {
  constructor(
    @InjectRepository(Peer)
    private readonly peerRepository: Repository<Peer>,
    private readonly serverManagement: ServerManagementService,
  ) {}

  async enrich(
    peers: PresencePeer[],
    onlineAfter: Date,
    includeReport = false,
  ): Promise<DevicePresenceEnrichment> {
    const snapshot = await this.serverManagement.getPeerSnapshot();
    if (!snapshot.available)
      return {
        available: false,
        reason: snapshot.reason,
        checked_at: snapshot.checked_at,
        byUuid: new Map(),
      };

    const index = this.index(snapshot);
    const byUuid = new Map<string, DevicePresenceView>();
    for (const peer of peers)
      byUuid.set(
        peer.uuid,
        this.viewFor(peer, this.match(peer, index), onlineAfter),
      );

    return {
      available: true,
      checked_at: snapshot.checked_at,
      byUuid,
      ...(includeReport
        ? { report: await this.buildReport(snapshot, onlineAfter) }
        : {}),
    };
  }

  private index(snapshot: HbbsPeerSnapshot): PeerIndex {
    const byUuid = new Map<string, HbbsPeerSnapshotEntry>();
    const byIsolatedUuid = new Map<string, HbbsPeerSnapshotEntry>();
    for (const peer of snapshot.peers) {
      const uuid = decodeHbbsUuid(peer.uuid);
      if (!uuid) continue;
      byUuid.set(uuid, peer);
      byIsolatedUuid.set(isolatedDeviceUuid(uuid, peer.id), peer);
    }
    return { byUuid, byIsolatedUuid };
  }

  private match(
    peer: PresencePeer,
    index: PeerIndex,
  ): HbbsPeerSnapshotEntry | undefined {
    // Both keys are exact: the raw client UUID for legacy rows, and the key
    // derived from the hbbs UUID + ID for clone-isolated rows. There is no
    // ambiguous ID fallback, so a duplicate RustDesk ID cannot receive the
    // registration of the other device.
    return index.byUuid.get(peer.uuid) ?? index.byIsolatedUuid.get(peer.uuid);
  }

  private viewFor(
    peer: PresencePeer,
    entry: HbbsPeerSnapshotEntry | undefined,
    onlineAfter: Date,
  ): DevicePresenceView {
    const consoleOnline =
      peer.lastHeartbeat !== null && peer.lastHeartbeat > onlineAfter;
    const hbbsOnline = entry?.online === true;
    // Disabled devices are intentionally kept out of the admission layer, so
    // their absence from hbbs is not an anomaly.
    const anomaly =
      peer.status === PeerStatus.ACTIVE
        ? hbbsOnline && !consoleOnline
          ? 'hbbs_online_console_offline'
          : consoleOnline && !hbbsOnline
            ? 'console_online_hbbs_offline'
            : null
        : null;
    return {
      registered: entry !== undefined,
      online: hbbsOnline,
      ip: entry?.ip ?? '',
      address: entry?.address ?? null,
      last_registration_age_seconds:
        entry?.last_registration_age_seconds ?? null,
      banned: entry?.banned === true,
      anomaly,
    };
  }

  private async buildReport(
    snapshot: HbbsPeerSnapshot,
    onlineAfter: Date,
  ): Promise<DevicePresenceReport> {
    const peers = await this.peerRepository.find({
      select: ['uuid', 'id', 'status', 'lastHeartbeat'],
    });
    // Use the same UUID-first matching as the per-device views so clone
    // isolation (derived Console ID) does not show up as a false mismatch.
    const index = this.index(snapshot);
    const consoleOnline = new Set(
      peers
        .filter(
          (peer) =>
            peer.status === PeerStatus.ACTIVE &&
            peer.lastHeartbeat !== null &&
            peer.lastHeartbeat > onlineAfter,
        )
        .map((peer) => peer.uuid),
    );
    const matchedHbbsIds = new Set<string>();
    const hbbsOnlineConsoleOffline = new Set<string>();
    const consoleOnlineHbbsOffline = new Set<string>();

    for (const peer of peers) {
      const entry = this.match(peer, index);
      if (entry) matchedHbbsIds.add(entry.id);
      const isActive = peer.status === PeerStatus.ACTIVE;
      if (!isActive) continue;
      const hbbsOnline = entry?.online === true;
      if (hbbsOnline && !consoleOnline.has(peer.uuid))
        hbbsOnlineConsoleOffline.add(peer.id);
      else if (!hbbsOnline && consoleOnline.has(peer.uuid))
        consoleOnlineHbbsOffline.add(peer.id);
    }

    const hbbsOnline = snapshot.peers.filter((peer) => peer.online);
    const hbbsOnly = new Set(
      hbbsOnline
        .filter((peer) => !matchedHbbsIds.has(peer.id))
        .map((peer) => peer.id),
    );

    const hbbsMismatch = {
      count: hbbsOnlineConsoleOffline.size,
      device_ids: sortIds(hbbsOnlineConsoleOffline),
    };
    const consoleMismatch = {
      count: consoleOnlineHbbsOffline.size,
      device_ids: sortIds(consoleOnlineHbbsOffline),
    };
    const hbbsOnlyMismatch = {
      count: hbbsOnly.size,
      device_ids: sortIds(hbbsOnly),
    };

    return {
      available: true,
      checked_at: snapshot.checked_at,
      hbbs: {
        registered: snapshot.peers.length,
        online: hbbsOnline.length,
      },
      console: {
        total: peers.length,
        online: consoleOnline.size,
      },
      mismatches: {
        hbbs_online_console_offline: hbbsMismatch,
        console_online_hbbs_offline: consoleMismatch,
        hbbs_only: hbbsOnlyMismatch,
      },
      anomaly_count:
        hbbsMismatch.count + consoleMismatch.count + hbbsOnlyMismatch.count,
    };
  }
}
