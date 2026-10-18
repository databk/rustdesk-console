import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { DeviceTombstone } from './entities/device-tombstone.entity';
import {
  DeviceStatus,
  DeviceOperationResult,
  DeviceOperationFailure,
} from './dto/device-status.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import type { PermissionScope } from '../rbac/services/rbac-authorization.service';
import { UserRoleAssignmentDeviceGroup } from '../rbac/entities/user-role-assignment-device-group.entity';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';
import { StrategyService } from '../strategy/strategy.service';
import {
  ServerManagementService,
  type DeviceBanSyncResult,
} from '../server-management/server-management.service';

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
    @InjectRepository(DeviceTombstone)
    private deviceTombstoneRepository: Repository<DeviceTombstone>,
    @InjectRepository(Strategy)
    private strategyRepository: Repository<Strategy>,
    private readonly dataSource: DataSource,
    private readonly rbacAuthorizationService: RbacAuthorizationService,
    private readonly strategyService: StrategyService,
    private readonly serverManagement: ServerManagementService,
  ) {}

  // Protocol-level enforcement writes the hbbs ban policy, which is guarded
  // by the server management permission; without it the database flag alone
  // only restricts web remote control. Only an authorization denial means
  // "no permission"; anything else (e.g. a failing permission lookup) is an
  // error the caller reports instead of a silent skip.
  private async canEnforceProtocolBans(actorGuid: string): Promise<boolean> {
    try {
      await this.rbacAuthorizationService.requirePermission(
        actorGuid,
        'servers.ban',
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

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
    query: { current?: number; pageSize?: number; name?: string },
    isAdmin: boolean = false,
    rbacScope?: PermissionScope,
  ): Promise<{
    data: { guid: string; name: string; note?: string }[];
    total: number;
  }> {
    const { current = 1, pageSize = 20, name } = query;
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
      current?: number;
      pageSize?: number;
      status?: string;
      name?: string;
      group_name?: string;
    },
    isAdmin: boolean = false,
  ): Promise<{ data: any[]; total: number }> {
    const { current = 1, pageSize = 20, status, name, group_name } = query;
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
    const affectedUuids: string[] = [];
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

      const affectedPeers = await manager
        .getRepository(Peer)
        .find({ where: { deviceGroupGuid: guid }, select: ['uuid'] });
      affectedUuids.push(...affectedPeers.map((p) => p.uuid));

      await deviceGroupRepository.remove(deviceGroup);
    });
    for (const uuid of affectedUuids) {
      this.strategyService.invalidateDeviceStrategyCache(uuid);
    }
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
      this.strategyService.invalidateDeviceStrategyCache(peer.uuid);
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
      this.strategyService.invalidateDeviceStrategyCache(peer.uuid);
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
      current?: number;
      pageSize?: number;
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
      current = 1,
      pageSize = 20,
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
      this.strategyService.invalidateDeviceStrategyCache(guid);
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

    // Reflect the status change in the hbbs admission policy so native
    // clients are blocked too; a database flag alone only restricts the web
    // client. Best effort: the committed database state stays authoritative
    // and the result reports whether the protocol layer followed.
    let protocolEnforcement: DeviceBanSyncResult | undefined;
    if (guidsToUpdate.length > 0) {
      const deviceIds = existingPeers
        .filter((peer) => guidsToUpdate.includes(peer.uuid) && peer.id)
        .map((peer) => peer.id)
        .filter((id, index, all) => all.indexOf(id) === index);
      if (deviceIds.length > 0) {
        protocolEnforcement = await this.syncDeviceBans(
          actorGuid,
          status === DeviceStatus.DISABLED
            ? { add: deviceIds }
            : { remove: deviceIds },
        );
      }
    }

    return {
      succeeded,
      failed,
      total: uniqueGuids.length,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      ...(protocolEnforcement ? { protocolEnforcement } : {}),
    };
  }

  // Tombstone management sees and restores devices across every group, so
  // a device-group-scoped devices.delete permission is not enough.
  private async assertGlobalDeleteScope(actorGuid: string) {
    const scope = await this.rbacAuthorizationService.requirePermission(
      actorGuid,
      'devices.delete',
    );
    if (!scope.global)
      throw new ForbiddenException(
        'Deleted devices can only be managed with a global permission',
      );
  }

  private async syncDeviceBans(
    actorGuid: string,
    changes: { add?: string[]; remove?: string[] },
  ): Promise<DeviceBanSyncResult> {
    try {
      if (!(await this.canEnforceProtocolBans(actorGuid)))
        return { enforced: false, reason: 'forbidden' };
    } catch (error) {
      return {
        enforced: false,
        reason: 'upstream_error',
        detail: `Failed to verify the servers.ban permission: ${String(error)}`,
      };
    }
    return this.serverManagement.syncDeviceBans(actorGuid, changes);
  }

  // Releasing a device id writes the hbbs peer registry, guarded by the same
  // server management permission as the ban policy. Best effort like the
  // ban sync: the committed database deletion stays authoritative.
  private async releaseDeviceId(
    actorGuid: string,
    deviceId: string,
  ): Promise<DeviceBanSyncResult> {
    try {
      if (!(await this.canEnforceProtocolBans(actorGuid)))
        return { enforced: false, reason: 'forbidden' };
    } catch (error) {
      return {
        enforced: false,
        reason: 'upstream_error',
        detail: `Failed to verify the servers.ban permission: ${String(error)}`,
      };
    }
    return this.serverManagement.releaseDeviceId(actorGuid, deviceId);
  }

  /**
   * Delete device
   *
   * Deleting only the database row was reversible by a single heartbeat,
   * because the heartbeat handler recreates unknown devices on sight. The
   * deletion now also writes a tombstone so the device stays deleted, and by
   * default bans the device id at the hbbs admission layer so the native
   * client cannot register either. The device id is also released from the
   * hbbs peer registry so a replacement machine can claim a custom id such
   * as a hostname again.
   * @param guid Device GUID
   */
  async deleteDevice(
    guid: string,
    actorGuid: string,
    options: { protocolBan?: boolean; releaseId?: boolean } = {},
  ) {
    const { scope, peer } =
      await this.rbacAuthorizationService.assertDeviceAccess(
        actorGuid,
        'devices.delete',
        guid,
      );
    const deviceId = peer.id;
    // The tombstone and the peer deletion must land atomically: between the
    // two writes a concurrent heartbeat could recreate the peer, and an
    // existing peer is never checked against tombstones again.
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager
          .getRepository(DeviceTombstone)
          .upsert({ uuid: guid, deviceId, deletedBy: actorGuid }, ['uuid']);
        const result = await manager.getRepository(Peer).delete(
          scope.global
            ? { uuid: guid }
            : {
                uuid: guid,
                deviceGroupGuid: In([...scope.deviceGroupGuids]),
              },
        );
        if (result.affected !== 1) {
          throw new ConflictException(
            'Device information has changed, please retry',
          );
        }
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        // The row vanished between the access check and the delete; ask the
        // authorization service again so a missing device yields 404 instead
        // of a misleading conflict.
        await this.rbacAuthorizationService.assertDeviceAccess(
          actorGuid,
          'devices.delete',
          guid,
        );
      }
      throw error;
    }

    let protocolEnforcement: DeviceBanSyncResult | undefined;
    if (options.protocolBan !== false && deviceId) {
      protocolEnforcement = await this.syncDeviceBans(actorGuid, {
        add: [deviceId],
      });
      if (protocolEnforcement.enforced)
        await this.deviceTombstoneRepository.update(
          { uuid: guid },
          { banned: true },
        );
    }
    let idRelease: DeviceBanSyncResult | undefined;
    if (options.releaseId !== false && deviceId) {
      idRelease = await this.releaseDeviceId(actorGuid, deviceId);
    }
    return {
      message: 'Device deleted',
      ...(protocolEnforcement
        ? {
            protocolEnforcement: protocolEnforcement.enforced
              ? protocolEnforcement
              : {
                  ...protocolEnforcement,
                  detail:
                    'The device stays deleted, but it can still register with the servers until the ban is applied.',
                },
          }
        : {}),
      ...(idRelease
        ? {
            idRelease: idRelease.enforced
              ? idRelease
              : {
                  ...idRelease,
                  detail:
                    'The device stays deleted, but its id remains bound to the old machine at the servers until it is released.',
                },
          }
        : {}),
    };
  }

  /**
   * List deleted devices (tombstones)
   *
   * Tombstones span every device group, so only a global devices.delete
   * scope may inspect them.
   */
  async listTombstones(actorGuid: string) {
    await this.assertGlobalDeleteScope(actorGuid);
    const tombstones = await this.deviceTombstoneRepository.find({
      order: { createdAt: 'DESC' },
    });
    return { data: tombstones };
  }

  /**
   * Restore a deleted device
   *
   * Removes the tombstone so heartbeats re-admit the device, and lifts the
   * protocol ban that was recorded at deletion time.
   * @param uuid Device UUID
   */
  async restoreTombstone(uuid: string, actorGuid: string) {
    await this.assertGlobalDeleteScope(actorGuid);
    const tombstone = await this.deviceTombstoneRepository.findOne({
      where: { uuid },
    });
    if (!tombstone) throw new NotFoundException('Deleted device not found');
    let protocolEnforcement: DeviceBanSyncResult | undefined;
    if (tombstone.banned && tombstone.deviceId) {
      protocolEnforcement = await this.syncDeviceBans(actorGuid, {
        remove: [tombstone.deviceId],
      });
      // Keep the tombstone until the protocol ban is confirmed lifted: it
      // is the only record of which device id must be unbanned, so losing
      // it on a failed sync would leave the device banned with no way to
      // retry the restore.
      if (!protocolEnforcement.enforced) {
        return {
          message: 'Device not restored; the protocol ban could not be lifted',
          protocolEnforcement,
        };
      }
    }
    // Best effort: retry the id release in case it failed at deletion time
    // (the id would stay bound to the old machine forever). Never blocks
    // the restore itself; releasing an already-free id is a no-op.
    let idRelease: DeviceBanSyncResult | undefined;
    if (tombstone.deviceId) {
      idRelease = await this.releaseDeviceId(actorGuid, tombstone.deviceId);
    }
    await this.deviceTombstoneRepository.delete({ uuid });
    return {
      message: 'Device restored; it can register again',
      ...(protocolEnforcement ? { protocolEnforcement } : {}),
      ...(idRelease
        ? {
            idRelease: idRelease.enforced
              ? idRelease
              : {
                  ...idRelease,
                  detail:
                    'The device is restored, but its id may still be bound to the old machine at the servers.',
                },
          }
        : {}),
    };
  }
}
