import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import * as uuid from 'uuid';
import { DeviceGroup } from './entities/device-group.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { DeviceGroupUserPermission } from './entities/device-group-user-permission.entity';
import {
  DeviceStatus,
  DeviceOperationResult,
  DeviceOperationFailure,
} from './dto/device-status.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import type { PermissionScope } from '../rbac/services/rbac-authorization.service';
import { UserRoleAssignmentDeviceGroup } from '../rbac/entities/user-role-assignment-device-group.entity';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';

@Injectable()
/**
 * DeviceGroupService
 * Core service responsible for device group management and permission control
 *
 * Features:
 * - Device group creation and management
 * - Device group permission management
 * - User permission management
 * - Accessible resource queries
 *
 * Architecture:
 * Manages the permission relationships between device groups and users
 */
export class DeviceGroupService {
  constructor(
    @InjectRepository(DeviceGroup)
    private deviceGroupRepository: Repository<DeviceGroup>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(Sysinfo)
    private sysinfoRepository: Repository<Sysinfo>,
    @InjectRepository(DeviceGroupUserPermission)
    private deviceGroupUserPermissionRepository: Repository<DeviceGroupUserPermission>,
    @InjectRepository(Strategy)
    private strategyRepository: Repository<Strategy>,
    private readonly dataSource: DataSource,
    private readonly rbacAuthorizationService: RbacAuthorizationService,
  ) {}

  /**
   * Get the list of device groups accessible to a user (paginated)
   * Administrators can see all device groups; regular users can only see device groups they have permission for
   *
   * @param userGuid User GUID
   * @param query Query parameters, including pagination info
   * @param isAdmin Whether the user is an administrator
   * @returns Device group list and total count
   */
  async getAccessibleDeviceGroups(
    userGuid: string,
    query: { current: number; pageSize: number; name?: string },
    isAdmin: boolean = false,
    rbacScope?: PermissionScope,
  ): Promise<{
    data: { guid: string; name: string; note?: string }[];
    total: number;
  }> {
    const { current, pageSize, name } = query;
    const skip = (current - 1) * pageSize;

    // Administrators can see all device groups
    if (isAdmin || rbacScope) {
      let queryBuilder = this.deviceGroupRepository
        .createQueryBuilder('dg')
        .select(['dg.guid', 'dg.name', 'dg.note'])
        .orderBy('dg.name', 'ASC')
        .skip(skip)
        .take(pageSize);

      if (rbacScope && !rbacScope.global) {
        if (rbacScope.deviceGroupGuids.size === 0) {
          queryBuilder = queryBuilder.andWhere('1 = 0');
        } else {
          queryBuilder = queryBuilder.andWhere(
            'dg.guid IN (:...rbacDeviceGroups)',
            { rbacDeviceGroups: [...rbacScope.deviceGroupGuids] },
          );
        }
      }

      if (name) {
        queryBuilder = queryBuilder.andWhere('dg.name LIKE :name', {
          name: `%${name}%`,
        });
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

    // Regular users can only see device groups they have permission for
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
      queryBuilder = queryBuilder.andWhere('dg.name LIKE :name', {
        name: `%${name}%`,
      });
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
   * Get the list of accessible users
   * Includes: oneself + users granted access + users indirectly accessible via device group authorization
   * Administrators can see all users
   *
   * @param userGuid User GUID
   * @param query Query parameters, including pagination and status filtering
   * @param isAdmin Whether the user is an administrator
   * @returns User list and total count
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

    // Administrators can see all users
    if (isAdmin) {
      const queryBuilder = this.userRepository
        .createQueryBuilder('user')
        .where('user.status = :status', {
          status: parseInt(status || '1') || UserStatus.ACTIVE,
        });

      // Filter by user name
      if (name) {
        queryBuilder.andWhere('user.username LIKE :name', {
          name: `%${name}%`,
        });
      }

      // Filter by group name (via device group)
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

    // Regular users can only see users they have permission to access
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

    // Filter by user name
    if (name) {
      queryBuilder.andWhere('user.username LIKE :name', { name: `%${name}%` });
    }

    // Filter by group name (via device group)
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
   * Create device group
   * @param name Device group name
   * @param note Remarks
   * @param allowedIncomings Allowed access rules
   * @returns The created device group
   */
  async createDeviceGroup(
    name: string,
    note: string | undefined,
    _allowedIncomings: unknown[] | undefined,
    actorGuid: string,
  ) {
    await this.rbacAuthorizationService.requireSuperAdmin(actorGuid);
    // Check whether the device group name already exists
    const existingGroup = await this.deviceGroupRepository.findOne({
      where: { name },
    });
    if (existingGroup) {
      throw new BadRequestException('Device group name already exists');
    }

    const deviceGroup = new DeviceGroup();
    deviceGroup.guid = uuid.v4();
    deviceGroup.name = name;
    deviceGroup.note = note || '';

    await this.deviceGroupRepository.save(deviceGroup);

    return { message: 'Device group created successfully' };
  }

  /**
   * Update device group
   * @param guid Device group GUID
   * @param name New name
   * @param note New remarks
   * @param allowedIncomings Allowed access rules
   * @returns Update result
   */
  async updateDeviceGroup(
    guid: string,
    name: string | undefined,
    note: string | undefined,
    _allowedIncomings: unknown[] | undefined,
    actorGuid: string,
  ) {
    await this.rbacAuthorizationService.requireSuperAdmin(actorGuid);
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { guid },
    });
    if (!deviceGroup) {
      throw new NotFoundException('Device group does not exist');
    }

    if (name !== undefined) {
      // Check whether the new name already exists
      const existingGroup = await this.deviceGroupRepository.findOne({
        where: { name },
      });
      if (existingGroup && existingGroup.guid !== guid) {
        throw new BadRequestException('Device group name already exists');
      }
      deviceGroup.name = name;
    }

    if (note !== undefined) {
      deviceGroup.note = note;
    }

    await this.deviceGroupRepository.save(deviceGroup);

    return { message: 'Device group updated successfully' };
  }

  /**
   * Delete device group
   * @param guid Device group GUID
   */
  async deleteDeviceGroup(guid: string, actorGuid: string) {
    await this.rbacAuthorizationService.requireSuperAdmin(actorGuid);
    await this.dataSource.transaction(async (manager) => {
      const deviceGroupRepository = manager.getRepository(DeviceGroup);
      const deviceGroup = await deviceGroupRepository.findOne({
        where: { guid },
      });
      if (!deviceGroup) {
        throw new NotFoundException('Device group does not exist');
      }

      const scopedAssignments = await manager
        .getRepository(UserRoleAssignmentDeviceGroup)
        .count({ where: { deviceGroupGuid: guid } });
      if (scopedAssignments > 0) {
        throw new BadRequestException(
          'The device group is still referenced by role authorizations and cannot be deleted; please remove the related authorizations first',
        );
      }

      await deviceGroupRepository.remove(deviceGroup);
    });
  }

  /**
   * Add devices to device group
   * @param guid Device group GUID
   * @param deviceIds List of device IDs
   */
  async addDevicesToGroup(
    guid: string,
    deviceIds: string[],
    actorGuid: string,
  ) {
    await this.rbacAuthorizationService.requireSuperAdmin(actorGuid);
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { guid },
    });
    if (!deviceGroup) {
      throw new NotFoundException('Device group does not exist');
    }

    // Look up all devices
    const peers = await this.peerRepository.find({
      where: { id: In(deviceIds) },
    });

    if (peers.length === 0) {
      throw new NotFoundException('Device does not exist');
    }

    // Update the devices' device group
    for (const peer of peers) {
      await this.peerRepository.update(
        { uuid: peer.uuid },
        { deviceGroupGuid: guid },
      );
    }

    return { message: 'Devices added successfully' };
  }

  /**
   * Remove devices from device group
   * @param guid Device group GUID
   * @param deviceIds List of device IDs
   */
  async removeDevicesFromGroup(
    guid: string,
    deviceIds: string[],
    actorGuid: string,
  ) {
    await this.rbacAuthorizationService.requireSuperAdmin(actorGuid);
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { guid },
    });
    if (!deviceGroup) {
      throw new NotFoundException('Device group does not exist');
    }

    // Look up all devices
    const peers = await this.peerRepository.find({
      where: { id: In(deviceIds), deviceGroupGuid: guid },
    });

    if (peers.length === 0) {
      throw new NotFoundException(
        'Device does not exist or is not in this device group',
      );
    }

    // Remove the devices' device group
    for (const peer of peers) {
      await this.peerRepository.update(
        { uuid: peer.uuid },
        { deviceGroupGuid: null },
      );
    }

    return { message: 'Devices removed successfully' };
  }

  /**
   * Get device list
   * @param userGuid User GUID
   * @param query Query parameters
   * @param isAdmin Whether the user is an administrator
   * @returns Device list and total count
   */
  async getDevices(
    userGuid: string,
    query: {
      current: number;
      pageSize: number;
      id?: string;
      status?: string;
      is_online?: string;
      device_name?: string;
      user_name?: string;
      device_username?: string;
      os?: string;
      device_group_name?: string;
      device_group_guid?: string;
      group_name?: string;
    },
    isAdmin: boolean = false,
    rbacScope?: PermissionScope,
  ): Promise<{ data: any[]; total: number }> {
    const {
      current,
      pageSize,
      id,
      status,
      is_online,
      device_name,
      user_name,
      device_username,
      os,
      device_group_name,
      device_group_guid,
      group_name,
    } = query;
    const skip = (current - 1) * pageSize;
    const onlineAfter = new Date(Date.now() - 60_000);

    let queryBuilder = this.peerRepository
      .createQueryBuilder('peer')
      .leftJoin('peer.deviceGroup', 'dg')
      .select([
        'peer.id',
        'peer.uuid',
        'peer.userGuid',
        'peer.deviceGroupGuid',
        'peer.strategyGuid',
        'peer.note',
        'peer.status',
        'peer.ver',
        'peer.modifiedAt',
        'peer.lastHeartbeat',
        'peer.updatedAt',
        'dg.name',
      ]);

    // Administrators can see all devices
    if (!isAdmin && !rbacScope) {
      // Regular users can only see devices they have permission to access
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

    // RBAC scope is an additional administrative boundary. It is applied
    // before pagination/count and intentionally excludes ungrouped devices.
    if (rbacScope && !rbacScope.global) {
      if (!rbacScope.deviceGroupGuids.size) {
        queryBuilder = queryBuilder.andWhere('1 = 0');
      } else {
        queryBuilder = queryBuilder.andWhere(
          'peer.deviceGroupGuid IN (:...rbacDeviceGroups)',
          { rbacDeviceGroups: [...rbacScope.deviceGroupGuids] },
        );
      }
    }

    // Filter by device ID
    if (id) {
      queryBuilder = queryBuilder.andWhere('peer.id LIKE :id', {
        id: `%${id}%`,
      });
    }

    if (status !== undefined) {
      queryBuilder = queryBuilder.andWhere('peer.status = :status', {
        status: Number(status),
      });
    }

    if (is_online === '1') {
      queryBuilder = queryBuilder.andWhere(
        'peer.lastHeartbeat > :onlineAfter',
        { onlineAfter },
      );
    } else if (is_online === '0') {
      queryBuilder = queryBuilder.andWhere(
        '(peer.lastHeartbeat IS NULL OR peer.lastHeartbeat <= :onlineAfter)',
        { onlineAfter },
      );
    }

    // Filter by device name
    if (device_name) {
      queryBuilder = queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM sysinfos si
          WHERE si.uuid = peer.uuid AND si.hostname LIKE :deviceName
        )`,
        { deviceName: `%${device_name}%` },
      );
    }

    // Filter by user name
    if (user_name) {
      queryBuilder = queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM users u
          WHERE u.guid = peer.userGuid AND u.username LIKE :userName
        )`,
        { userName: `%${user_name}%` },
      );
    }

    // Filter by device user name
    if (device_username) {
      queryBuilder = queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM sysinfos si
          WHERE si.uuid = peer.uuid AND si.username LIKE :deviceUsername
        )`,
        { deviceUsername: `%${device_username}%` },
      );
    }

    // Filter by device group name (exact match)
    if (device_group_name) {
      queryBuilder = queryBuilder.andWhere('dg.name = :deviceGroupName', {
        deviceGroupName: device_group_name,
      });
    }

    if (device_group_guid) {
      queryBuilder = queryBuilder.andWhere(
        'peer.deviceGroupGuid = :deviceGroupGuid',
        { deviceGroupGuid: device_group_guid },
      );
    }

    if (os) {
      queryBuilder = queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM sysinfos si
          WHERE si.uuid = peer.uuid AND si.os LIKE :os
        )`,
        { os: `%${os}%` },
      );
    }

    // Filter by group name (via device group)
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

    const uuids = peers.map((peer) => peer.uuid);
    const userGuids = [
      ...new Set(
        peers
          .map((peer) => peer.userGuid)
          .filter((guid): guid is string => guid !== null),
      ),
    ];
    const strategyGuids = [
      ...new Set(
        peers
          .map((peer) => peer.strategyGuid)
          .filter((guid): guid is string => guid !== null),
      ),
    ];
    const [sysinfos, users, strategies]: [Sysinfo[], User[], Strategy[]] =
      await Promise.all([
        uuids.length
          ? this.sysinfoRepository.find({ where: { uuid: In(uuids) } })
          : [],
        userGuids.length
          ? this.userRepository.find({ where: { guid: In(userGuids) } })
          : [],
        strategyGuids.length
          ? this.strategyRepository.find({
              where: { guid: In(strategyGuids) },
            })
          : [],
      ]);
    const sysinfoByUuid = new Map(sysinfos.map((item) => [item.uuid, item]));
    const userByGuid = new Map(users.map((item) => [item.guid, item]));
    const strategyByGuid = new Map(strategies.map((item) => [item.guid, item]));
    const formatVersion = (version: number): string => {
      if (!version) return '';
      const major = Math.floor(version / 1_000_000);
      const minor = Math.floor((version % 1_000_000) / 1_000);
      const patch = Math.floor((version % 1_000) / 10);
      const suffix = version % 10;
      return `${major}.${minor}.${patch}${suffix ? `-${suffix}` : ''}`;
    };

    const data = peers.map((peer) => {
      const sysinfo = sysinfoByUuid.get(peer.uuid);
      return {
        guid: peer.uuid,
        id: peer.id,
        userGuid: peer.userGuid,
        user: peer.userGuid || '',
        user_name: peer.userGuid
          ? userByGuid.get(peer.userGuid)?.username || ''
          : '',
        deviceGroupGuid: peer.deviceGroupGuid,
        device_group_name:
          (peer.deviceGroup as { name?: string } | null)?.name || '',
        strategy_name: peer.strategyGuid
          ? strategyByGuid.get(peer.strategyGuid)?.name || ''
          : '',
        note: peer.note || '',
        status: peer.status,
        is_online: peer.lastHeartbeat
          ? peer.lastHeartbeat > onlineAfter
          : false,
        last_online: peer.lastHeartbeat?.toISOString() || null,
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

  /**
   * Update device properties
   * Supports partially updating the device's user, device group, strategy and remarks
   * Pass a string value -> look up by name and associate
   * Pass null -> clear the association
   * Omit a field -> that property is left unchanged
   *
   * @param guid Device GUID
   * @param dto Update data
   */
  async updateDevice(guid: string, dto: UpdateDeviceDto, actorGuid: string) {
    const { scope } = await this.rbacAuthorizationService.assertDeviceAccess(
      actorGuid,
      'devices.edit',
      guid,
    );
    if (
      dto.userName !== undefined ||
      dto.deviceGroupName !== undefined ||
      dto.strategyName !== undefined
    ) {
      await this.rbacAuthorizationService.requireSuperAdmin(actorGuid);
    }
    const updateData: Partial<Peer> = {};

    if (dto.userName !== undefined) {
      if (dto.userName === null) {
        updateData.userGuid = null;
      } else {
        const user = await this.userRepository.findOne({
          where: { username: dto.userName },
        });
        if (!user) {
          throw new NotFoundException('User does not exist');
        }
        updateData.userGuid = user.guid;
      }
    }

    if (dto.deviceGroupName !== undefined) {
      if (dto.deviceGroupName === null) {
        updateData.deviceGroupGuid = null;
      } else {
        const deviceGroup = await this.deviceGroupRepository.findOne({
          where: { name: dto.deviceGroupName },
        });
        if (!deviceGroup) {
          throw new NotFoundException('Device group does not exist');
        }
        updateData.deviceGroupGuid = deviceGroup.guid;
      }
    }

    if (dto.strategyName !== undefined) {
      if (dto.strategyName === null) {
        updateData.strategyGuid = null;
      } else {
        const strategy = await this.strategyRepository.findOne({
          where: { name: dto.strategyName },
        });
        if (!strategy) {
          throw new NotFoundException('Strategy does not exist');
        }
        updateData.strategyGuid = strategy.guid;
      }
    }

    if (dto.note !== undefined) {
      updateData.note = dto.note;
    }

    if (Object.keys(updateData).length > 0) {
      const result = await this.peerRepository.update(
        scope.global
          ? { uuid: guid }
          : {
              uuid: guid,
              deviceGroupGuid: In([...scope.deviceGroupGuids]),
            },
        updateData,
      );
      if (result.affected !== 1) {
        await this.rbacAuthorizationService.assertDeviceAccess(
          actorGuid,
          'devices.edit',
          guid,
        );
        throw new ConflictException(
          'Device information has changed, please retry',
        );
      }
    }
  }

  /**
   * Batch update device status
   * Supports enabling or disabling multiple devices in batch, returning detailed success/failure information
   *
   * @param guids List of device GUIDs
   * @param status Target status
   * @returns Operation result, including information on successful and failed devices
   */
  async updateDeviceStatus(
    guids: string[],
    status: DeviceStatus,
    actorGuid: string,
  ): Promise<DeviceOperationResult> {
    const { peers: existingPeers, scope } =
      await this.rbacAuthorizationService.assertDevicesAccess(
        actorGuid,
        'devices.status',
        guids,
      );
    const uniqueGuids = [...new Set(guids)];
    const succeeded: string[] = [];
    const failed: DeviceOperationFailure[] = [];

    const existingUuids = new Set(existingPeers.map((p) => p.uuid));

    for (const guid of uniqueGuids) {
      if (!existingUuids.has(guid)) {
        failed.push({ guid, reason: 'Device not found' });
      }
    }

    const guidsToUpdate = uniqueGuids.filter((guid) => existingUuids.has(guid));

    if (guidsToUpdate.length > 0) {
      const statusValue =
        status === DeviceStatus.ENABLED
          ? PeerStatus.ACTIVE
          : PeerStatus.DISABLED;

      const concurrentChange = new ConflictException(
        'Device information has changed, please retry',
      );
      try {
        await this.dataSource.transaction(async (manager) => {
          const result = await manager.update(
            Peer,
            scope.global
              ? { uuid: In(guidsToUpdate) }
              : {
                  uuid: In(guidsToUpdate),
                  deviceGroupGuid: In([...scope.deviceGroupGuids]),
                },
            { status: statusValue },
          );
          if (result.affected !== guidsToUpdate.length) {
            throw concurrentChange;
          }
        });
      } catch (error) {
        if (error === concurrentChange) {
          await this.rbacAuthorizationService.assertDevicesAccess(
            actorGuid,
            'devices.status',
            guidsToUpdate,
          );
        }
        throw error;
      }

      succeeded.push(...guidsToUpdate);
    }

    return {
      succeeded,
      failed,
      total: uniqueGuids.length,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    };
  }

  /**
   * Delete device
   * @param guid Device GUID
   */
  async deleteDevice(guid: string, actorGuid: string) {
    const { scope } = await this.rbacAuthorizationService.assertDeviceAccess(
      actorGuid,
      'devices.delete',
      guid,
    );
    const result = await this.peerRepository.delete(
      scope.global
        ? { uuid: guid }
        : {
            uuid: guid,
            deviceGroupGuid: In([...scope.deviceGroupGuids]),
          },
    );
    if (result.affected !== 1) {
      await this.rbacAuthorizationService.assertDeviceAccess(
        actorGuid,
        'devices.delete',
        guid,
      );
      throw new ConflictException(
        'Device information has changed, please retry',
      );
    }
  }
}
