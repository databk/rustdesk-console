import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Peer } from '../../../common/entities';

@Injectable()
/**
 * AuthDeviceService
 * 负责设备绑定的子服务
 *
 * 与主服务关系：
 * 被AuthService委托处理设备相关操作
 *
 * 调用上下文：
 * 包括设备绑定、解绑和状态管理
 */
export class AuthDeviceService {
  private readonly logger = new Logger(AuthDeviceService.name);

  constructor(
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
  ) {}

  /**
   * 创建或更新设备记录
   * 将设备绑定到用户账户，用于追踪用户的登录设备
   * 
   * @param userGuid 用户GUID
   * @param deviceId 设备ID（可选）
   * @param deviceUuid 设备UUID
   * @param deviceInfo 设备信息（可选）
   */
  async createOrUpdateDevice(
    userGuid: string,
    deviceId?: string,
    deviceUuid?: string,
    deviceInfo?: Record<string, any>,
  ): Promise<void> {
    if (!deviceUuid) return;

    // 查找peer记录
    const peer = await this.peerRepository.findOne({
      where: { uuid: deviceUuid },
    });

    if (peer) {
      // 更新peer的userGuid，绑定设备到用户
      peer.userGuid = userGuid;
      await this.peerRepository.save(peer);
      this.logger.log(`设备 ${deviceUuid} 已绑定到用户 ${userGuid}`);
    }
    // 如果peer不存在，设备会在心跳时自动创建
  }

  /**
   * 解除设备与用户的绑定
   * 在用户登出时调用，解除设备与用户的关联
   * 
   * 安全措施：防止退出登录后设备仍关联用户
   * 
   * @param userGuid 用户GUID
   * @param deviceUuid 设备UUID
   */
  async unbindDevice(userGuid: string, deviceUuid: string): Promise<void> {
    const peer = await this.peerRepository.findOne({
      where: { uuid: deviceUuid, userGuid },
    });

    if (peer) {
      peer.userGuid = null as any;
      await this.peerRepository.save(peer);
      this.logger.log(`用户 ${userGuid} 退出登录，已解除设备 ${deviceUuid} 的绑定`);
    }
  }
}
