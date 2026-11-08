import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Peer } from '../../../common/entities';
import { GeneralSettingsService } from '../../settings/services/general-settings.service';

/** Matches the online window used by the device list and dashboard. */
export const HEARTBEAT_ONLINE_WINDOW_MS = 60_000;

/**
 * Diagnostics wait for two online windows before declaring the whole
 * deployment degraded. The client sends a heartbeat every 15 seconds, so this
 * tolerates a few missed beats without raising a false alarm.
 */
export const HEARTBEAT_DEGRADED_WINDOW_MS = 120_000;

export type HeartbeatHealthStatus =
  'ok' | 'heartbeat_stale' | 'suspected_api_scheme_mismatch';

export interface HeartbeatHealthSnapshot {
  status: HeartbeatHealthStatus;
  heartbeat: {
    /** Last heartbeat accepted from any device, or null if none was seen. */
    lastReceivedAt: string | null;
    secondsSinceLastReceived: number | null;
    degraded: boolean;
    degradedAfterSeconds: number;
  };
  devices: {
    total: number;
    online: number;
    stale: number;
  };
  site: {
    /** Value configured in Settings -> General -> site.frontendUrl. */
    frontendUrl: string;
    /** Public origin used for the suggested API server, when resolvable. */
    effectiveOrigin: string | null;
    exposedOverHttps: boolean;
    /** True when the configured origin terminates TLS on port 21114. */
    usesHttpsOn21114: boolean;
  };
  /** Value the RustDesk client should use as its API server. */
  suggestedApiServer: string | null;
  /**
   * All known devices are heartbeat-stale while the console is exposed over
   * HTTPS. This is the signature of clients still using the legacy
   * `http://<id-server>:21114` default.
   */
  likelyApiServerSchemeMismatch: boolean;
}

function parseHttpOrigin(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

@Injectable()
export class HeartbeatHealthService implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatHealthService.name);

  /**
   * In-memory timestamp of the last heartbeat accepted by this process. It is
   * seeded from the database at startup so a restart during an outage does not
   * hide the degradation until the first heartbeat arrives.
   */
  private lastHeartbeatAt: number | null = null;

  constructor(
    @InjectRepository(Peer)
    private readonly peerRepository: Repository<Peer>,
    private readonly generalSettings: GeneralSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const persisted = await this.readLatestPersistedHeartbeat();
    if (persisted !== null) {
      this.lastHeartbeatAt = persisted;
    }
  }

  /** Latest heartbeat persisted by any replica, or null if none exists. */
  private async readLatestPersistedHeartbeat(): Promise<number | null> {
    try {
      const latest = await this.peerRepository.findOne({
        where: { lastHeartbeat: Not(IsNull()) },
        order: { lastHeartbeat: 'DESC' },
        select: ['uuid', 'lastHeartbeat'],
      });
      return latest?.lastHeartbeat?.getTime() ?? null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Unable to read the latest persisted heartbeat: ${message}`,
      );
      return null;
    }
  }

  /** Called for every accepted heartbeat, including ones later ignored. */
  markHeartbeat(): void {
    this.lastHeartbeatAt = Date.now();
  }

  async getHealth(requestOrigin?: string): Promise<HeartbeatHealthSnapshot> {
    const now = Date.now();
    const onlineAfter = new Date(now - HEARTBEAT_ONLINE_WINDOW_MS);

    const total = await this.peerRepository.count();
    const persistedOnline = await this.peerRepository
      .createQueryBuilder('peer')
      .where('peer.lastHeartbeat > :onlineAfter', { onlineAfter })
      .getCount();

    // In multi-replica deployments heartbeat traffic can land on another
    // process. The shared database timestamp keeps each replica's diagnostic
    // from declaring an outage that only this replica is missing.
    const persistedHeartbeatAt = await this.readLatestPersistedHeartbeat();
    const lastHeartbeatAt =
      persistedHeartbeatAt === null
        ? this.lastHeartbeatAt
        : this.lastHeartbeatAt === null
          ? persistedHeartbeatAt
          : Math.max(this.lastHeartbeatAt, persistedHeartbeatAt);

    const recentlyReceived =
      lastHeartbeatAt !== null &&
      now - lastHeartbeatAt <= HEARTBEAT_ONLINE_WINDOW_MS;
    // The database flush lags in-memory heartbeats by up to 15 seconds. Keep
    // the reported online count from claiming that every device is stale
    // immediately after a heartbeat was accepted.
    const online =
      total === 0 ? 0 : Math.max(persistedOnline, recentlyReceived ? 1 : 0);
    const stale = Math.max(0, total - online);

    const site = await this.generalSettings.getSiteSettings();
    const configuredOrigin = parseHttpOrigin(site.frontendUrl);
    const requestUrl = parseHttpOrigin(requestOrigin);
    const effectiveOrigin = configuredOrigin ?? requestUrl;

    const secondsSinceLastReceived =
      lastHeartbeatAt === null
        ? null
        : Math.max(0, Math.floor((now - lastHeartbeatAt) / 1000));

    const degraded =
      total > 0 &&
      (lastHeartbeatAt === null ||
        now - lastHeartbeatAt > HEARTBEAT_DEGRADED_WINDOW_MS);

    const exposedOverHttps = effectiveOrigin?.protocol === 'https:';
    const usesHttpsOn21114 =
      exposedOverHttps === true && effectiveOrigin?.port === '21114';
    const suggestedApiServer = effectiveOrigin?.origin ?? null;

    // Only blame the API scheme when every device is stale and the console is
    // demonstrably served over HTTPS. Any recent heartbeat, or a plain-HTTP
    // deployment, must keep pointing at the deployment itself.
    const likelyApiServerSchemeMismatch =
      degraded &&
      total > 0 &&
      stale === total &&
      exposedOverHttps === true &&
      suggestedApiServer !== null;

    return {
      status: likelyApiServerSchemeMismatch
        ? 'suspected_api_scheme_mismatch'
        : degraded
          ? 'heartbeat_stale'
          : 'ok',
      heartbeat: {
        lastReceivedAt:
          lastHeartbeatAt === null
            ? null
            : new Date(lastHeartbeatAt).toISOString(),
        secondsSinceLastReceived,
        degraded,
        degradedAfterSeconds: HEARTBEAT_DEGRADED_WINDOW_MS / 1000,
      },
      devices: {
        total,
        online,
        stale,
      },
      site: {
        frontendUrl: site.frontendUrl,
        effectiveOrigin: suggestedApiServer,
        exposedOverHttps: exposedOverHttps === true,
        usesHttpsOn21114,
      },
      suggestedApiServer,
      likelyApiServerSchemeMismatch,
    };
  }
}
