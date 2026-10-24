import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Peer } from '../../common/entities';
import { DeviceTombstone } from '../device-group/entities/device-tombstone.entity';
import { ActiveConnection } from './entities/active-connection.entity';
import { DisconnectStoreService } from './services/disconnect-store.service';
import { HeartbeatCacheService } from './services/heartbeat-cache.service';
import { StrategyService } from '../strategy/strategy.service';
import {
  resolveDeviceUuid,
  cloneIsolationEnabled,
} from '../../common/utils/device-identity.util';

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(ActiveConnection)
    private activeConnectionRepository: Repository<ActiveConnection>,
    @InjectRepository(DeviceTombstone)
    private deviceTombstoneRepository: Repository<DeviceTombstone>,
    private disconnectStoreService: DisconnectStoreService,
    private strategyService: StrategyService,
    private heartbeatCacheService: HeartbeatCacheService,
  ) {}

  async handleHeartbeat(data: HeartbeatDto) {
    if (cloneIsolationEnabled()) {
      // Check legacy tombstones before deriving a new key, so deleted devices
      // cannot reappear just because isolation was enabled after deletion.
      const legacyTombstone = await this.deviceTombstoneRepository.findOne({
        where: { uuid: data.uuid },
      });
      if (legacyTombstone?.deviceId === data.id) return;
    }
    data = {
      ...data,
      uuid: await resolveDeviceUuid(this.peerRepository, data.uuid, data.id),
    };
    this.logger.debug(
      `Received heartbeat data: id=${data.id}, uuid=${data.uuid}`,
    );

    const existingPeer = await this.peerRepository.findOne({
      where: { uuid: data.uuid },
    });

    if (existingPeer) {
      this.heartbeatCacheService.bufferPeerUpdate(data.uuid, {
        id: data.id,
        ver: data.ver,
        modifiedAt: data.modified_at,
        lastHeartbeat: new Date(),
      });
      this.logger.debug(`Device ${data.uuid} heartbeat updated`);
    } else {
      // A deleted device must stay deleted: heartbeats no longer resurrect
      // tombstoned devices. Restoring the tombstone re-admits them.
      const tombstone = await this.deviceTombstoneRepository.findOne({
        where: { uuid: data.uuid },
      });
      if (tombstone) {
        this.logger.debug(`Ignored heartbeat from deleted device ${data.uuid}`);
        return;
      }
      const peer = this.peerRepository.create({
        id: data.id,
        uuid: data.uuid,
        ver: data.ver,
        modifiedAt: data.modified_at,
        lastHeartbeat: new Date(),
      });
      await this.peerRepository.save(peer);
      this.logger.log(`New device ${data.uuid} registered`);
    }

    if (data.conns !== undefined) {
      this.heartbeatCacheService.bufferConns(data.uuid, data.conns);
      this.disconnectStoreService.removeDisconnected(data.uuid, data.conns);
    }

    const disconnect = this.disconnectStoreService.getPendingDisconnects(
      data.uuid,
    );

    const strategyResult = existingPeer
      ? await this.resolveStrategy(existingPeer, data.modified_at)
      : null;

    return {
      ...(disconnect.length > 0 ? { disconnect } : {}),
      ...(strategyResult
        ? {
            strategy: { config_options: strategyResult.config_options },
            modified_at: strategyResult.modified_at,
          }
        : {}),
    };
  }

  async getActiveConnectionIds(deviceUuid: string): Promise<number[]> {
    const buffered = this.heartbeatCacheService.getBufferedConns(deviceUuid);
    if (buffered !== undefined) {
      return buffered;
    }
    const connections = await this.activeConnectionRepository.find({
      where: { deviceUuid },
      select: ['connId'],
    });
    return connections.map((c) => c.connId);
  }

  private async resolveStrategy(
    peer: Peer,
    clientModifiedAt: number,
  ): Promise<{
    config_options: Record<string, string>;
    modified_at: number;
  } | null> {
    try {
      const strategy = await this.strategyService.findStrategyForPeer(peer);
      if (!strategy) {
        return null;
      }

      if (strategy.updatedAt.getTime() > clientModifiedAt) {
        const configOptions: Record<string, string> = JSON.parse(
          strategy.configOptions || '{}',
        ) as Record<string, string>;
        return {
          config_options: configOptions,
          modified_at: strategy.updatedAt.getTime(),
        };
      }

      return null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Device ${peer.uuid} strategy resolution failed: ${msg}`,
      );
      return null;
    }
  }
}
