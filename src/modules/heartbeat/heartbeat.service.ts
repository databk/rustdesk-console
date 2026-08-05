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
    this.logger.log(
      `[handleHeartbeat] 开始处理心跳: id=${data.id}, uuid=${data.uuid}, ver=${data.ver}, modified_at=${data.modified_at}, conns=${JSON.stringify(data.conns ?? [])}`,
    );

    const existingPeer = await this.peerRepository.findOne({
      where: { uuid: data.uuid },
    });

    this.logger.debug(
      `[handleHeartbeat] 设备查询结果: uuid=${data.uuid}, exists=${!!existingPeer}`,
    );

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
      this.logger.log(
        `[handleHeartbeat] 设备心跳已更新: uuid=${data.uuid}, id=${data.id}, ver=${data.ver}`,
      );
    } else {
      const peer = this.peerRepository.create({
        id: data.id,
        uuid: data.uuid,
        ver: data.ver,
        modifiedAt: data.modified_at,
        lastHeartbeat: new Date(),
      });
      await this.peerRepository.save(peer);
      this.logger.log(
        `[handleHeartbeat] 新设备已注册: uuid=${data.uuid}, id=${data.id}, ver=${data.ver}`,
      );
    }

    if (data.conns !== undefined) {
      this.logger.debug(
        `[handleHeartbeat] 开始同步活跃连接: uuid=${data.uuid}, conns=${JSON.stringify(data.conns)}`,
      );
      await this.syncActiveConnections(data.uuid, data.conns);
      this.logger.debug(
        `[handleHeartbeat] 开始处理断开连接: uuid=${data.uuid}, currentConns=${JSON.stringify(data.conns)}`,
      );
      this.disconnectStoreService.removeDisconnected(data.uuid, data.conns);
      this.logger.debug(
        `[handleHeartbeat] 断开连接处理完成: uuid=${data.uuid}`,
      );
    } else {
      this.logger.debug(
        `[handleHeartbeat] 心跳未携带conns字段，跳过连接同步: uuid=${data.uuid}`,
      );
    }

    const disconnect = this.disconnectStoreService.getPendingDisconnects(
      data.uuid,
    );
    this.logger.debug(
      `[handleHeartbeat] 待断开连接查询: uuid=${data.uuid}, pendingDisconnects=${JSON.stringify(disconnect)}`,
    );

    const strategyResult = await this.resolveStrategy(
      data.uuid,
      data.modified_at,
    );
    this.logger.debug(
      `[handleHeartbeat] 策略解析结果: uuid=${data.uuid}, hasStrategy=${!!strategyResult}${strategyResult ? `, modified_at=${strategyResult.modified_at}` : ''}`,
    );

    const result = {
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

    this.logger.log(
      `[handleHeartbeat] 心跳处理完成: uuid=${data.uuid}, code=${result.code}, hasDisconnect=${disconnect.length > 0}, hasStrategy=${!!strategyResult}`,
    );

    return result;
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
      this.logger.debug(
        `[resolveStrategy] 开始解析策略: uuid=${deviceUuid}, clientModifiedAt=${clientModifiedAt}`,
      );

      const strategy =
        await this.strategyService.findStrategyForDevice(deviceUuid);
      if (!strategy) {
        this.logger.debug(
          `[resolveStrategy] 设备无关联策略: uuid=${deviceUuid}`,
        );
        return null;
      }

      this.logger.debug(
        `[resolveStrategy] 找到策略: uuid=${deviceUuid}, strategyUpdatedAt=${strategy.updatedAt.getTime()}, clientModifiedAt=${clientModifiedAt}, needsUpdate=${strategy.updatedAt.getTime() > clientModifiedAt}`,
      );

      if (strategy.updatedAt.getTime() > clientModifiedAt) {
        const configOptions: Record<string, string> = JSON.parse(
          strategy.configOptions || '{}',
        ) as Record<string, string>;
        this.logger.log(
          `[resolveStrategy] 策略需更新: uuid=${deviceUuid}, configKeys=${Object.keys(configOptions).join(',')}`,
        );
        return {
          config_options: configOptions,
          modified_at: strategy.updatedAt.getTime(),
        };
      }

      this.logger.debug(
        `[resolveStrategy] 策略无需更新: uuid=${deviceUuid}, 客户端已是最新`,
      );
      return null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[resolveStrategy] 策略解析失败: uuid=${deviceUuid}, error=${msg}`);
      return null;
    }
  }

  private async syncActiveConnections(
    deviceUuid: string,
    conns: number[],
  ): Promise<void> {
    this.logger.debug(
      `[syncActiveConnections] 开始同步: uuid=${deviceUuid}, newConns=${JSON.stringify(conns)}`,
    );

    const existingConns = await this.activeConnectionRepository.find({
      where: { deviceUuid },
      select: ['connId'],
    });
    this.logger.debug(
      `[syncActiveConnections] 当前数据库连接: uuid=${deviceUuid}, existingCount=${existingConns.length}, existingConnIds=${JSON.stringify(existingConns.map((c) => c.connId))}`,
    );

    await this.activeConnectionRepository.delete({ deviceUuid });

    if (conns.length > 0) {
      const entities = conns.map((connId) =>
        this.activeConnectionRepository.create({
          connId,
          deviceUuid,
        }),
      );
      await this.activeConnectionRepository.save(entities);
      this.logger.log(
        `[syncActiveConnections] 连接已同步: uuid=${deviceUuid}, count=${conns.length}, connIds=${JSON.stringify(conns)}`,
      );
    } else {
      this.logger.log(
        `[syncActiveConnections] 清空所有连接: uuid=${deviceUuid}, previousCount=${existingConns.length}`,
      );
    }
  }
}
