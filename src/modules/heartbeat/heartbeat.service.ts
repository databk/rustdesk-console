import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Peer } from '../../common/entities';

/**
 * 心跳服务
 * 负责处理设备的定期心跳信号，保持设备在线状态
 * 
 * 功能：
 * - 接收设备心跳数据
 * - 创建或更新设备记录
 * - 维护设备在线状态
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
  ) {}

  /**
   * 处理设备心跳
   * 接收设备发送的心跳数据，创建或更新设备记录
   * 
   * @param data 心跳数据，包含设备ID、UUID、版本号等信息
   * @returns 心跳处理结果，包含响应码和设备信息
   */
  async handleHeartbeat(data: HeartbeatDto) {
    this.logger.debug(`收到心跳数据: id=${data.id}, uuid=${data.uuid}`);

    const existingPeer = await this.peerRepository.findOne({
      where: { uuid: data.uuid }
    });

    if (existingPeer) {
      // 设备已存在，更新记录
      await this.peerRepository.update(
        { uuid: data.uuid },
        {
          id: data.id,
          ver: data.ver,
          modifiedAt: data.modified_at,
        }
      );
      this.logger.debug(`设备 ${data.uuid} 心跳已更新`);
    } else {
      // 设备不存在，创建新记录
      const peer = this.peerRepository.create({
        id: data.id,
        uuid: data.uuid,
        ver: data.ver,
        modifiedAt: data.modified_at,
      });
      await this.peerRepository.save(peer);
      this.logger.log(`新设备 ${data.uuid} 已注册`);
    }

    return {
      code: 200,
      message: '心跳接收成功',
      data: {
        timestamp: Date.now(),
        device_id: data.id,
      },
    };
  }
}
