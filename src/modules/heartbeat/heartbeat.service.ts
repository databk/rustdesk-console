import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Peer } from '../../common/entities';
import { ActiveConnection } from './entities/active-connection.entity';
import { DisconnectStoreService } from './services/disconnect-store.service';
import { StrategyService } from '../strategy/strategy.service';

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(ActiveConnection)
    private activeConnectionRepository: Repository<ActiveConnection>,
    private disconnectStoreService: DisconnectStoreService,
    private strategyService: StrategyService,
  ) {}

  async handleHeartbeat(data: HeartbeatDto) {
    this.logger.debug(`收到心跳数据: id=${data.id}, uuid=${data.uuid}`);

    const existingPeer = await this.peerRepository.findOne({
      where: { uuid: data.uuid },
    });

    if (existingPeer) {
      await this.peerRepository.update(
        { uuid: data.uuid },
        {
          id: data.id,
          ver: data.ver,
          modifiedAt: data.modified_at,
          lastHeartbeat: new Date(),
        },
      );
      this.logger.debug(`设备 ${data.uuid} 心跳已更新`);
    } else {
      const peer = this.peerRepository.create({
        id: data.id,
        uuid: data.uuid,
        ver: data.ver,
        modifiedAt: data.modified_at,
        lastHeartbeat: new Date(),
      });
      await this.peerRepository.save(peer);
      this.logger.log(`新设备 ${data.uuid} 已注册`);
    }

    if (data.conns !== undefined) {
      await this.syncActiveConnections(data.uuid, data.conns);
      this.disconnectStoreService.removeDisconnected(data.uuid, data.conns);
    }

    const disconnect = this.disconnectStoreService.getPendingDisconnects(
      data.uuid,
    );

    const strategyResult = await this.resolveStrategy(
      data.uuid,
      data.modified_at,
    );

    return {
      code: 200,
      message: '心跳接收成功',
      ...(disconnect.length > 0 ? { disconnect } : {}),
      ...(strategyResult
        ? {
            strategy: { config_options: strategyResult.config_options },
            modified_at: strategyResult.modified_at,
          }
        : {}),
      data: {
        timestamp: Date.now(),
        device_id: data.id,
      },
    };
  }

  async getActiveConnectionIds(deviceUuid: string): Promise<number[]> {
    const connections = await this.activeConnectionRepository.find({
      where: { deviceUuid },
      select: ['connId'],
    });
    return connections.map((c) => c.connId);
  }

  private async resolveStrategy(
    deviceUuid: string,
    clientModifiedAt: number,
  ): Promise<{
    config_options: Record<string, string>;
    modified_at: number;
  } | null> {
    try {
      const strategy =
        await this.strategyService.findStrategyForDevice(deviceUuid);
      if (!strategy) {
        return null;
      }

      if (strategy.modifiedAt > clientModifiedAt) {
        const configOptions: Record<string, string> = JSON.parse(
          strategy.configOptions || '{}',
        ) as Record<string, string>;
        return {
          config_options: configOptions,
          modified_at: strategy.modifiedAt,
        };
      }

      return null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`设备 ${deviceUuid} 策略解析失败: ${msg}`);
      return null;
    }
  }

  private async syncActiveConnections(
    deviceUuid: string,
    conns: number[],
  ): Promise<void> {
    await this.activeConnectionRepository.delete({ deviceUuid });

    if (conns.length > 0) {
      const entities = conns.map((connId) =>
        this.activeConnectionRepository.create({
          connId,
          deviceUuid,
        }),
      );
      await this.activeConnectionRepository.save(entities);
    }

    this.logger.debug(`设备 ${deviceUuid} 活跃连接已同步: ${conns.length} 个`);
  }
}
