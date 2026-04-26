import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as uuid from 'uuid';
import { DeviceGroup } from './entities/device-group.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { DeviceGroupUserPermission } from './entities/device-group-user-permission.entity';

@Injectable()
/**
 * DeviceGroupService
 * 负责设备组管理和权限控制的核心服务
 *
 * 功能：
 * - 设备组创建和管理
 * - 设备组权限管理
 * - 用户权限管理
 * - 可访问资源查询
 *
 * 架构说明：
 * 管理设备组和用户之间的权限关系
 */
export class DeviceGroupService {
  constructor(
    @InjectRepository(DeviceGroup)
    private deviceGroupRepository: Repository<DeviceGroup>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(DeviceGroupUserPermission)
    private deviceGroupUserPermissionRepository: Repository<DeviceGroupUserPermission>,
  ) {}

  /**
   * 获取用户可访问的设备组列表（分页）
   * 管理员可以看到所有设备组，普通用户只能看到有权限的设备组
   *
   * @param userGuid 用户GUID
   * @param query 查询参数，包含分页信息
   * @param isAdmin 是否为管理员
   * @returns 设备组列表和总数
   */
  async getAccessibleDeviceGroups(
    userGuid: string,
    query: { current: number; pageSize: number; name?: string },
    isAdmin: boolean = false,
  ): Promise<{
    data: { guid: string; name: string; note?: string }[];
    total: number;
  }> {
    const { current, pageSize, name } = query;
    const skip = (current - 1) * pageSize;

    // 管理员可以看到所有设备组
    if (isAdmin) {
      let queryBuilder = this.deviceGroupRepository
        .createQueryBuilder('dg')
        .select(['dg.guid', 'dg.name', 'dg.note'])
        .orderBy('dg.name', 'ASC')
        .skip(skip)
        .take(pageSize);

      if (name) {
        queryBuilder = queryBuilder.andWhere('dg.name = :name', { name });
      }

      const [groups, total] = await queryBuilder.getManyAndCount();

      return {
        data: groups.map((g) => ({
          guid: g.guid,
          name: g.name,
          note: g.note || '',
        })),
        total,
      };
    }

    // 普通用户只能看到有权限的设备组
    let queryBuilder = this.deviceGroupRepository
      .createQueryBuilder('dg')
      .innerJoin(
        'device_group_user_permissions',
        'udgp',
        'udgp.deviceGroupGuid = dg.guid',
      )
      .where('udgp.userGuid = :userGuid', { userGuid })
      .select(['dg.guid', 'dg.name', 'dg.note'])
      .orderBy('dg.name', 'ASC')
      .skip(skip)
      .take(pageSize);

    if (name) {
      queryBuilder = queryBuilder.andWhere('dg.name = :name', { name });
    }

    const [groups, total] = await queryBuilder.getManyAndCount();

    return {
      data: groups.map((g) => ({
        guid: g.guid,
        name: g.name,
        note: g.note || '',
      })),
      total,
    };
  }

  /**
   * 获取可访问的用户列表
   * 包括：自己 + 被授权访问的用户 + 通过设备组授权间接可访问的用户
   * 管理员可以看到所有用户
   *
   * @param userGuid 用户GUID
   * @param query 查询参数，包含分页和状态过滤
   * @param isAdmin 是否为管理员
   * @returns 用户列表和总数
   */
  async getAccessibleUsers(
    userGuid: string,
    query: {
      current: number;
      pageSize: number;
      status?: string;
      name?: string;
      group_name?: string;
    },
    isAdmin: boolean = false,
  ): Promise<{ data: any[]; total: number }> {
    const { current, pageSize, status, name, group_name } = query;
    const skip = (current - 1) * pageSize;

    // 管理员可以看到所有用户
    if (isAdmin) {
      const queryBuilder = this.userRepository
        .createQueryBuilder('user')
        .where('user.status = :status', {
          status: parseInt(status || '1') || UserStatus.ACTIVE,
        });

      // 按用户名过滤
      if (name) {
        queryBuilder.andWhere('user.username LIKE :name', {
          name: `%${name}%`,
        });
      }

      // 按组名过滤（通过设备组）
      if (group_name) {
        queryBuilder.andWhere(
          `EXISTS (
            SELECT 1 FROM device_group_user_permissions udgp
            INNER JOIN device_groups dg ON udgp.deviceGroupGuid = dg.guid
            WHERE udgp.userGuid = user.guid AND dg.name LIKE :groupName
          )`,
          { groupName: `%${group_name}%` },
        );
      }

      const [users, total] = await queryBuilder
        .orderBy('user.username', 'ASC')
        .skip(skip)
        .take(pageSize)
        .getManyAndCount();

      return {
        data: users.map((u) => ({
          guid: u.guid,
          name: u.username,
          email: u.email || '',
          note: u.note || '',
          status: u.status,
          is_admin: u.isAdmin,
        })),
        total,
      };
    }

    // 普通用户只能看到有权限访问的用户
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .where('user.status = :status', {
        status: parseInt(status || '1') || UserStatus.ACTIVE,
      })
      .andWhere(
        `(user.guid = :userGuid
          OR EXISTS (
            SELECT 1 FROM user_user_permissions uup
            WHERE uup.userGuid = :userGuid AND uup.targetUserGuid = user.guid
          )
          OR EXISTS (
            SELECT 1 FROM peers p
            INNER JOIN device_group_user_permissions udgp ON p.deviceGroupGuid = udgp.deviceGroupGuid
            WHERE udgp.userGuid = :userGuid AND p.userGuid = user.guid
          )
        )`,
        { userGuid },
      );

    // 按用户名过滤
    if (name) {
      queryBuilder.andWhere('user.username LIKE :name', { name: `%${name}%` });
    }

    // 按组名过滤（通过设备组）
    if (group_name) {
      queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM device_group_user_permissions udgp
          INNER JOIN device_groups dg ON udgp.deviceGroupGuid = dg.guid
          WHERE udgp.userGuid = user.guid AND dg.name LIKE :groupName
        )`,
        { groupName: `%${group_name}%` },
      );
    }

    const [users, total] = await queryBuilder
      .orderBy('user.username', 'ASC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    return {
      data: users.map((u) => ({
        guid: u.guid,
        name: u.username,
        email: u.email || '',
        note: u.note || '',
        status: u.status,
        is_admin: u.isAdmin,
      })),
      total,
    };
  }

  /**
   * 创建设备组
   * @param name 设备组名称
   * @param note 备注
   * @param allowedIncomings 允许访问的规则
   * @returns 创建的设备组
   */
  async createDeviceGroup(
    name: string,
    note?: string,
    _allowedIncomings?: unknown[],
  ) {
    // 检查设备组名称是否已存在
    const existingGroup = await this.deviceGroupRepository.findOne({
      where: { name },
    });
    if (existingGroup) {
      throw new BadRequestException('设备组名称已存在');
    }

    const deviceGroup = new DeviceGroup();
    deviceGroup.guid = uuid.v4();
    deviceGroup.name = name;
    deviceGroup.note = note || '';

    await this.deviceGroupRepository.save(deviceGroup);

    return { message: '设备组创建成功' };
  }

  /**
   * 更新设备组
   * @param guid 设备组GUID
   * @param name 新名称
   * @param note 新备注
   * @param allowedIncomings 允许访问的规则
   * @returns 更新结果
   */
  async updateDeviceGroup(
    guid: string,
    name?: string,
    note?: string,
    _allowedIncomings?: unknown[],
  ) {
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { guid },
    });
    if (!deviceGroup) {
      throw new NotFoundException('设备组不存在');
    }

    if (name !== undefined) {
      // 检查新名称是否已存在
      const existingGroup = await this.deviceGroupRepository.findOne({
        where: { name },
      });
      if (existingGroup && existingGroup.guid !== guid) {
        throw new BadRequestException('设备组名称已存在');
      }
      deviceGroup.name = name;
    }

    if (note !== undefined) {
      deviceGroup.note = note;
    }

    await this.deviceGroupRepository.save(deviceGroup);

    return { message: '设备组更新成功' };
  }

  /**
   * 删除设备组
   * @param guid 设备组GUID
   */
  async deleteDeviceGroup(guid: string) {
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { guid },
    });
    if (!deviceGroup) {
      throw new NotFoundException('设备组不存在');
    }

    await this.deviceGroupRepository.remove(deviceGroup);
  }

  /**
   * 添加设备到设备组
   * @param guid 设备组GUID
   * @param deviceIds 设备ID列表
   */
  async addDevicesToGroup(guid: string, deviceIds: string[]) {
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { guid },
    });
    if (!deviceGroup) {
      throw new NotFoundException('设备组不存在');
    }

    // 查找所有设备
    const peers = await this.peerRepository.find({
      where: { id: In(deviceIds) },
    });

    if (peers.length === 0) {
      throw new NotFoundException('设备不存在');
    }

    // 更新设备的设备组
    for (const peer of peers) {
      peer.deviceGroupGuid = guid;
      await this.peerRepository.save(peer);
    }

    return { message: '设备添加成功' };
  }

  /**
   * 从设备组中移除设备
   * @param guid 设备组GUID
   * @param deviceIds 设备ID列表
   */
  async removeDevicesFromGroup(guid: string, deviceIds: string[]) {
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { guid },
    });
    if (!deviceGroup) {
      throw new NotFoundException('设备组不存在');
    }

    // 查找所有设备
    const peers = await this.peerRepository.find({
      where: { id: In(deviceIds), deviceGroupGuid: guid },
    });

    if (peers.length === 0) {
      throw new NotFoundException('设备不存在或不在该设备组中');
    }

    // 移除设备的设备组
    for (const peer of peers) {
      peer.deviceGroupGuid = null;
      await this.peerRepository.save(peer);
    }

    return { message: '设备移除成功' };
  }

  /**
   * 获取设备列表
   * @param userGuid 用户GUID
   * @param query 查询参数
   * @param isAdmin 是否为管理员
   * @returns 设备列表和总数
   */
  async getDevices(
    userGuid: string,
    query: {
      current: number;
      pageSize: number;
      id?: string;
      device_name?: string;
      user_name?: string;
      device_username?: string;
      device_group_name?: string;
      group_name?: string;
    },
    isAdmin: boolean = false,
  ): Promise<{ data: any[]; total: number }> {
    const {
      current,
      pageSize,
      id,
      device_name,
      user_name,
      device_username,
      device_group_name,
      group_name,
    } = query;
    const skip = (current - 1) * pageSize;

    let queryBuilder = this.peerRepository
      .createQueryBuilder('peer')
      .leftJoin('peer.deviceGroup', 'dg')
      .select([
        'peer.id',
        'peer.uuid',
        'peer.userGuid',
        'peer.deviceGroupGuid',
        'peer.ver',
        'peer.modifiedAt',
        'peer.updatedAt',
        'dg.name',
      ]);

    // 管理员可以看到所有设备
    if (!isAdmin) {
      // 普通用户只能看到自己有权限访问的设备
      queryBuilder = queryBuilder.andWhere(
        `(peer.userGuid = :userGuid
          OR EXISTS (
            SELECT 1 FROM device_group_user_permissions udgp
            WHERE udgp.userGuid = :userGuid AND udgp.deviceGroupGuid = peer.deviceGroupGuid
          )
        )`,
        { userGuid },
      );
    }

    // 按设备ID过滤
    if (id) {
      queryBuilder = queryBuilder.andWhere('peer.id LIKE :id', {
        id: `%${id}%`,
      });
    }

    // 按设备名称过滤
    if (device_name) {
      queryBuilder = queryBuilder.andWhere('peer.name LIKE :deviceName', {
        deviceName: `%${device_name}%`,
      });
    }

    // 按用户名过滤
    if (user_name) {
      queryBuilder = queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM users u
          WHERE u.guid = peer.userGuid AND u.username LIKE :userName
        )`,
        { userName: `%${user_name}%` },
      );
    }

    // 按设备用户名过滤
    if (device_username) {
      queryBuilder = queryBuilder.andWhere(
        'peer.deviceUsername LIKE :deviceUsername',
        { deviceUsername: `%${device_username}%` },
      );
    }

    // 按设备组名过滤（精确匹配）
    if (device_group_name) {
      queryBuilder = queryBuilder.andWhere('dg.name = :deviceGroupName', {
        deviceGroupName: device_group_name,
      });
    }

    // 按组名过滤（通过设备组）
    if (group_name) {
      queryBuilder = queryBuilder.andWhere('dg.name LIKE :groupName', {
        groupName: `%${group_name}%`,
      });
    }

    const [peers, total] = await queryBuilder
      .orderBy('peer.id', 'ASC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    return {
      data: peers.map((p) => ({
        guid: p.uuid,
        id: p.id,
        userGuid: p.userGuid,
        deviceGroupGuid: p.deviceGroupGuid,
        device_group_name:
          (p.deviceGroup as { name?: string } | null)?.name || '',
        last_online: p.updatedAt,
      })),
      total,
    };
  }

  /**
   * 禁用设备
   * @param guid 设备GUID
   */
  async disableDevice(guid: string) {
    const peer = await this.peerRepository.findOne({
      where: { uuid: guid },
    });
    if (!peer) {
      throw new NotFoundException('设备不存在');
    }

    peer.status = PeerStatus.DISABLED;
    await this.peerRepository.save(peer);
  }

  /**
   * 启用设备
   * @param guid 设备GUID
   */
  async enableDevice(guid: string) {
    const peer = await this.peerRepository.findOne({
      where: { uuid: guid },
    });
    if (!peer) {
      throw new NotFoundException('设备不存在');
    }

    peer.status = PeerStatus.ACTIVE;
    await this.peerRepository.save(peer);
  }

  /**
   * 删除设备
   * @param guid 设备GUID
   */
  async deleteDevice(guid: string) {
    const peer = await this.peerRepository.findOne({
      where: { uuid: guid },
    });
    if (!peer) {
      throw new NotFoundException('设备不存在');
    }

    await this.peerRepository.remove(peer);
  }

  /**
   * 批量设置设备状态
   * @param guids 设备GUID列表
   * @param enable true=启用, false=禁用
   */
  async setPeersStatus(guids: string[], enable: boolean) {
    const status = enable ? PeerStatus.ACTIVE : PeerStatus.DISABLED;
    await this.peerRepository
      .createQueryBuilder()
      .update(Peer)
      .set({ status })
      .where('uuid IN (:...guids)', { guids })
      .execute();
  }

  /**
   * 分配设备属性
   * @param guid 设备GUID
   * @param type 属性类型
   * @param value 属性值
   */
  async assignDevice(guid: string, type: string, value: string) {
    const peer = await this.peerRepository.findOne({
      where: { uuid: guid },
    });
    if (!peer) {
      throw new NotFoundException('设备不存在');
    }

    switch (type) {
      case 'user_name': {
        const user = await this.userRepository.findOne({
          where: { username: value },
        });
        if (!user) {
          throw new NotFoundException('用户不存在');
        }
        peer.userGuid = user.guid;
        break;
      }
      case 'device_group_name': {
        const deviceGroup = await this.deviceGroupRepository.findOne({
          where: { name: value },
        });
        if (!deviceGroup) {
          throw new NotFoundException('设备组不存在');
        }
        peer.deviceGroupGuid = deviceGroup.guid;
        break;
      }
      case 'note':
        // note字段不存在于Peer实体中，暂时忽略
        break;
      case 'device_username':
      case 'device_name':
      case 'ab':
      case 'strategy_name':
        // 这些字段需要从Sysinfo中获取和更新
        break;
      default:
        throw new BadRequestException(`不支持的属性类型: ${type}`);
    }

    await this.peerRepository.save(peer);
  }
}
