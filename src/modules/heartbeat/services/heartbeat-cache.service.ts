import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager, In } from 'typeorm';
import { Peer } from '../../../common/entities';
import { ActiveConnection } from '../entities/active-connection.entity';

const HEARTBEAT_FLUSH_INTERVAL_MS = 15000;

interface BufferedPeerUpdate {
  lastHeartbeat: Date;
  id: string;
  ver: number;
  modifiedAt: number;
}

/**
 * Heartbeat cache service
 * Buffers high-frequency heartbeat writes in memory and flushes them to the
 * database in a single periodic transaction, eliminating per-heartbeat disk
 * writes. Connection lists are synced via diff (add/remove) instead of full
 * delete+insert.
 */
@Injectable()
export class HeartbeatCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatCacheService.name);
  private readonly peerBuffer = new Map<string, BufferedPeerUpdate>();
  private readonly connsBuffer = new Map<string, number[]>();
  private flushingConns = new Map<string, number[]>();
  private flushing = false;
  private activeFlush?: Promise<void>;

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Buffer a peer field update (id/ver/modifiedAt/lastHeartbeat) for later flush.
   */
  bufferPeerUpdate(uuid: string, update: BufferedPeerUpdate): void {
    this.peerBuffer.set(uuid, update);
  }

  /**
   * Buffer the latest reported active connection list for later diff-sync flush.
   */
  bufferConns(uuid: string, conns: number[]): void {
    this.connsBuffer.set(uuid, conns);
  }

  /**
   * Return the most recently buffered connection list for a device, if any.
   * Used to serve reads with in-memory freshness before the next flush.
   */
  getBufferedConns(uuid: string): number[] | undefined {
    return this.connsBuffer.get(uuid) ?? this.flushingConns.get(uuid);
  }

  @Interval(HEARTBEAT_FLUSH_INTERVAL_MS)
  async handleScheduledFlush(): Promise<void> {
    await this.flush();
  }

  /**
   * Flush all buffered updates to the database in a single transaction.
   * On failure, buffered entries are restored so they are retried next cycle.
   */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.activeFlush;
      return;
    }
    if (this.peerBuffer.size === 0 && this.connsBuffer.size === 0) {
      return;
    }

    this.flushing = true;
    const peerSnapshot = new Map(this.peerBuffer);
    const connsSnapshot = new Map(this.connsBuffer);
    this.flushingConns = connsSnapshot;
    this.peerBuffer.clear();
    this.connsBuffer.clear();

    const run = (async (): Promise<void> => {
      try {
        await this.dataSource.transaction(async (manager) => {
          for (const [uuid, update] of peerSnapshot) {
            await manager.update(Peer, { uuid }, update);
          }
          for (const [uuid, conns] of connsSnapshot) {
            const peer = await manager.findOne(Peer, {
              where: { uuid },
              select: ['uuid'],
            });
            if (!peer) {
              this.logger.warn(
                `Skipping connection sync for device ${uuid}: peer no longer exists`,
              );
              continue;
            }
            await this.syncConnectionsWithManager(manager, uuid, conns);
          }
        });
        this.logger.debug(
          `Flushed ${peerSnapshot.size} peer updates and ${connsSnapshot.size} connection syncs`,
        );
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to flush heartbeat buffer: ${msg}`);
        for (const [uuid, update] of peerSnapshot) {
          if (!this.peerBuffer.has(uuid)) {
            this.peerBuffer.set(uuid, update);
          }
        }
        for (const [uuid, conns] of connsSnapshot) {
          if (!this.connsBuffer.has(uuid)) {
            this.connsBuffer.set(uuid, conns);
          }
        }
      }
    })();

    this.activeFlush = run;
    try {
      await run;
    } finally {
      this.flushing = false;
      this.activeFlush = undefined;
      this.flushingConns = new Map();
    }
  }

  private async syncConnectionsWithManager(
    manager: EntityManager,
    deviceUuid: string,
    reportedConns: number[],
  ): Promise<void> {
    const existing = await manager.find(ActiveConnection, {
      where: { deviceUuid },
      select: ['connId'],
    });
    const existingSet = new Set(existing.map((c) => c.connId));
    const reportedSet = new Set(reportedConns);

    const toRemove = [...existingSet].filter((id) => !reportedSet.has(id));
    const toAdd = reportedConns.filter((id) => !existingSet.has(id));

    if (toRemove.length > 0) {
      await manager.delete(ActiveConnection, {
        deviceUuid,
        connId: In(toRemove),
      });
    }
    if (toAdd.length > 0) {
      await manager.insert(
        ActiveConnection,
        toAdd.map((connId) => ({ connId, deviceUuid })),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
    await this.flush();
  }
}