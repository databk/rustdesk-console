import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Peer } from '../../common/entities';
import { ActiveConnection } from './entities/active-connection.entity';
import { DisconnectStoreService } from './services/disconnect-store.service';

/**
 * 心跳服务
 * 负责处理设备的定期心跳信号，保持设备在线状态
 *
 * 功能：
 * - 接收设备心跳数据
 * - 创建或更新设备记录
 * - 维护设备在线状态
 * - 同步活跃连接信息
 * - 下发强制断开连接指令
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(ActiveConnection)
    private activeConnectionRepository: Repository<ActiveConnection>,
    private disconnectStoreService: DisconnectStoreService,
  ) {}

  /**
   * 处理设备心跳
   * 接收设备发送的心跳数据，创建或更新设备记录
   * 同时处理活跃连接同步和断开指令下发
   *
   * @param data 心跳数据，包含设备ID、UUID、版本号、活跃连接等信息
   * @returns 心跳处理结果，包含断开连接指令
   */
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

    // 同步活跃连接
    if (data.conns !== undefined) {
      await this.syncActiveConnections(data.uuid, data.conns);
    }

    // 获取待断开连接列表（取走后清空）
    const disconnect =
      this.disconnectStoreService.consumePendingDisconnects(data.uuid);

    return {
      code: 200,
      message: '心跳接收成功',
      data: {
        timestamp: Date.now(),
        device_id: data.id,
        ...(disconnect.length > 0 ? { disconnect } : {}),
      },
    };
  }

  /**
   * 同步活跃连接
   * 用客户端上报的连接列表替换该设备的所有活跃连接记录
   *
   * @param deviceUuid 设备UUID
   * @param conns 客户端上报的活跃连接ID列表
   */
  private async syncActiveConnections(
    deviceUuid: string,
    conns: number[],
  ): Promise<void> {
    // 删除该设备旧的活跃连接
    await this.activeConnectionRepository.delete({ deviceUuid });

    // 插入新的活跃连接
    if (conns.length > 0) {
      const entities = conns.map((connId) =>
        this.activeConnectionRepository.create({
          connId,
          deviceUuid,
        }),
      );
      await this.activeConnectionRepository.save(entities);
    }

    this.logger.debug(
      `设备 ${deviceUuid} 活跃连接已同步: ${conns.length} 个`,
    );
  }
}
