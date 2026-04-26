import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Peer, Sysinfo } from '../../common/entities';
import { User } from '../user/entities/user.entity';
import { DeviceGroup } from './entities/device-group.entity';
import { DeviceGroupUserPermission } from './entities/device-group-user-permission.entity';
import { UserUserPermission } from './entities/user-user-permission.entity';
import { PeerQueryDto } from './dto/peer.dto';

/**
 * 设备服务
 * 负责设备相关的业务逻辑和权限管理
 *
 * 功能：
 * - 获取用户可访问的设备列表
 * - 管理设备权限
 * - 处理设备在线状态
 */
@Injectable()
export class PeerService {
  constructor(
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(Sysinfo)
    private sysinfoRepository: Repository<Sysinfo>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(DeviceGroup)
    private deviceGroupRepository: Repository<DeviceGroup>,
    @InjectRepository(DeviceGroupUserPermission)
    private deviceGroupUserPermissionRepository: Repository<DeviceGroupUserPermission>,
    @InjectRepository(UserUserPermission)
    private userUserPermissionRepository: Repository<UserUserPermission>,
  ) {}

  /**
   * 获取用户可访问的设备列表（分页）
   * 根据用户权限返回可访问的设备列表
   *
   * 权限逻辑：
   * 1. 管理员可以看到所有设备
   * 2. 普通用户：
   *    - 用户自己的设备
   *    - 用户有权访问的设备组中的设备
   *    - 用户有权访问的其他用户的设备
   *
   * @param userGuid 用户GUID
   * @param query 查询参数，包含分页和状态过滤
   * @param isAdmin 是否为管理员
   * @returns 设备列表和总数
   */
  async getAccessiblePeers(
    userGuid: string,
    query: PeerQueryDto,
    isAdmin: boolean = false,
  ): Promise<{ data: any[]; total: number }> {
    const { current, pageSize, status } = query;
    const skip = (current - 1) * pageSize;

    // 计算一分钟前的时间（用于判断在线状态）
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

    // 构建查询
    const queryBuilder = this.peerRepository
      .createQueryBuilder('peer')
      .leftJoinAndSelect('peer.deviceGroup', 'deviceGroup');

    // 管理员可以看到所有设备
    if (!isAdmin) {
      queryBuilder.where(
        `(
          -- 用户自己的设备
          peer.userGuid = :userGuid
          -- 用户有权访问的设备组中的设备
          OR EXISTS (
            SELECT 1 FROM device_group_user_permissions udgp
            WHERE udgp.userGuid = :userGuid AND udgp.deviceGroupGuid = peer.deviceGroupGuid
          )
          -- 用户有权访问的其他用户的设备
          OR EXISTS (
            SELECT 1 FROM user_user_permissions uup
            WHERE uup.userGuid = :userGuid AND uup.targetUserGuid = peer.userGuid
          )
        )`,
        { userGuid },
      );
    }

    // 状态过滤：status='1' 表示只获取在线设备
    if (status === '1') {
      queryBuilder.andWhere('peer.updatedAt > :oneMinuteAgo', { oneMinuteAgo });
    }

    // 分页查询
    queryBuilder.orderBy('peer.id', 'ASC').skip(skip).take(pageSize);

    const [peers, total] = await queryBuilder.getManyAndCount();

    // 获取所有设备的 uuid 列表
    const uuids = peers.map((p) => p.uuid);

    // 批量查询系统信息
    const sysinfos =
      uuids.length > 0 ? await this.sysinfoRepository.findByIds(uuids) : [];

    const sysinfoMap = new Map(sysinfos.map((s) => [s.uuid, s]));

    // 获取所有相关的用户GUID
    const userGuids = [
      ...new Set(peers.map((p) => p.userGuid).filter((guid) => guid != null)),
    ];

    // 批量查询用户信息
    const users =
      userGuids.length > 0
        ? await this.userRepository.find({ where: { guid: In(userGuids) } })
        : [];
    const userMap = new Map(users.map((u) => [u.guid, u]));

    // 版本号转换函数：将 1001100 格式转换为 1.1.10 格式
    // 格式说明：major*1000000 + minor*1000 + patch*10 + patch_version
    // 例如：1.1.10 -> 1001100, 1.1.10-1 -> 1001101
    const formatVersion = (ver: number | null | undefined): string => {
      if (!ver) return '';
      const major = Math.floor(ver / 1000000);
      const minor = Math.floor((ver % 1000000) / 1000);
      const patch = Math.floor((ver % 1000) / 10);
      const patchVersion = ver % 10;

      let version = `${major}.${minor}.${patch}`;
      if (patchVersion > 0) {
        version += `-${patchVersion}`;
      }
      return version;
    };

    // 转换响应格式
    const data = peers.map((peer) => {
      const sysinfo = sysinfoMap.get(peer.uuid);
      const isOnline = peer.updatedAt > oneMinuteAgo;
      const user = peer.userGuid ? userMap.get(peer.userGuid) : null;
      const deviceGroupName =
        (peer.deviceGroup as { name?: string } | null)?.name || '';

      return {
        id: peer.id,
        guid: peer.uuid,
        status: peer.status,
        is_online: isOnline,
        last_online: peer.updatedAt.toISOString(),
        user: user?.username || '',
        user_name: user?.username || '',
        note: sysinfo?.presetNote || '',
        device_group_name: deviceGroupName,
        strategy_name: '', // 策略功能未实现，暂返回空
        info: {
          device_name: sysinfo?.hostname || '',
          username: sysinfo?.username || '',
          os: sysinfo?.os || '',
          version: formatVersion(peer.ver),
          cpu: sysinfo?.cpu || '',
          memory: sysinfo?.memory || '',
          ip: '',
        },
      };
    });

    return { data, total };
  }
}
