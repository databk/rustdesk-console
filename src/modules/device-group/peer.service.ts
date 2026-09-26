import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Peer, Sysinfo } from '../../common/entities';
import { User } from '../user/entities/user.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { PeerQueryDto } from './dto/peer.dto';

/**
 * Device service
 * Responsible for device-related business logic and permission management
 *
 * Features:
 * - Get the list of devices accessible to a user
 * - Manage device permissions
 * - Handle device online status
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
    @InjectRepository(Strategy)
    private strategyRepository: Repository<Strategy>,
  ) {}

  /**
   * Get the list of devices accessible to a user (paginated)
   * Returns the accessible device list based on user permissions
   *
   * Permission logic:
   * 1. Administrators can see all devices
   * 2. Regular users:
   *    - The user's own devices
   *    - Devices in device groups the user has access to
   *    - Devices of other users the user has access to
   *
   * Filter conditions:
   * - id: filter by device ID (fuzzy match)
   * - status: filter by device status ('0' = disabled, '1' = normal)
   * - is_online: filter by online status ('0' = offline, '1' = online)
   * - user_name: filter by user name (fuzzy match)
   * - device_group_name: filter by device group name (fuzzy match)
   * - os: filter by operating system (fuzzy match)
   *
   * @param userGuid User GUID
   * @param query Query parameters, including pagination and filter conditions
   * @param isAdmin Whether the user is an administrator
   * @returns Device list and total count
   */
  async getAccessiblePeers(
    userGuid: string,
    query: PeerQueryDto,
    isAdmin: boolean = false,
  ): Promise<{ data: any[]; total: number }> {
    const {
      current = 1,
      pageSize = 100,
      id,
      status,
      is_online,
      user_name,
      device_group_guid,
      device_group_name,
      os,
    } = query;
    const skip = (current - 1) * pageSize;

    // Calculate the time one minute ago (used to determine online status)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

    // Build the query
    const queryBuilder = this.peerRepository
      .createQueryBuilder('peer')
      .leftJoinAndSelect('peer.deviceGroup', 'deviceGroup');

    // Administrators can see all devices
    if (!isAdmin) {
      queryBuilder.where(
        `(
          -- The user's own devices
          peer.userGuid = :userGuid
          -- Devices in device groups the user has access to
          OR EXISTS (
            SELECT 1 FROM device_group_user_permissions udgp
            WHERE udgp.userGuid = :userGuid AND udgp.deviceGroupGuid = peer.deviceGroupGuid
          )
          -- Devices of other users the user has access to
          OR EXISTS (
            SELECT 1 FROM user_user_permissions uup
            WHERE uup.userGuid = :userGuid AND uup.targetUserGuid = peer.userGuid
          )
        )`,
        { userGuid },
      );
    }

    // Filter by device ID (fuzzy match)
    if (id) {
      queryBuilder.andWhere('peer.id LIKE :peerId', { peerId: `%${id}%` });
    }

    // Filter by device status: status='0' disabled, status='1' normal
    if (status !== undefined) {
      queryBuilder.andWhere('peer.status = :peerStatus', {
        peerStatus: parseInt(status),
      });
    }

    // Filter by online status
    if (is_online === '1') {
      queryBuilder.andWhere('peer.lastHeartbeat > :oneMinuteAgo', {
        oneMinuteAgo,
      });
    } else if (is_online === '0') {
      queryBuilder.andWhere(
        '(peer.lastHeartbeat IS NULL OR peer.lastHeartbeat <= :oneMinuteAgo)',
        { oneMinuteAgo },
      );
    }

    // Filter by user name (fuzzy match)
    if (user_name) {
      queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM users u
          WHERE u.guid = peer.userGuid AND u.username LIKE :userName
        )`,
        { userName: `%${user_name}%` },
      );
    }

    // Filter by device group GUID (exact match, higher priority)
    if (device_group_guid) {
      queryBuilder.andWhere('peer.deviceGroupGuid = :deviceGroupGuid', {
        deviceGroupGuid: device_group_guid,
      });
    }

    // Filter by device group name (fuzzy match)
    if (device_group_name && !device_group_guid) {
      queryBuilder.andWhere('deviceGroup.name LIKE :deviceGroupName', {
        deviceGroupName: `%${device_group_name}%`,
      });
    }

    // Filter by operating system (fuzzy match, requires joining the sysinfo table)
    if (os) {
      queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM sysinfos si
          WHERE si.uuid = peer.uuid AND si.os LIKE :osName
        )`,
        { osName: `%${os}%` },
      );
    }

    // Paginated query
    queryBuilder.orderBy('peer.id', 'ASC').skip(skip).take(pageSize);

    const [peers, total] = await queryBuilder.getManyAndCount();

    // Get the uuid list of all devices
    const uuids = peers.map((p) => p.uuid);

    // Batch query system information
    const sysinfos =
      uuids.length > 0 ? await this.sysinfoRepository.findByIds(uuids) : [];

    const sysinfoMap = new Map(sysinfos.map((s) => [s.uuid, s]));

    // Get all related user GUIDs
    const userGuids = [
      ...new Set(peers.map((p) => p.userGuid).filter((guid) => guid != null)),
    ];

    // Batch query user information
    const users =
      userGuids.length > 0
        ? await this.userRepository.find({ where: { guid: In(userGuids) } })
        : [];
    const userMap = new Map(users.map((u) => [u.guid, u]));

    const strategyGuids = [
      ...new Set(
        peers
          .map((p) => p.strategyGuid)
          .filter((guid): guid is string => guid != null),
      ),
    ];
    const strategies =
      strategyGuids.length > 0
        ? await this.strategyRepository.find({
            where: { guid: In(strategyGuids) },
          })
        : [];
    const strategyMap = new Map(strategies.map((s) => [s.guid, s]));

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

    // Convert the response format
    const data = peers.map((peer) => {
      const sysinfo = sysinfoMap.get(peer.uuid);
      const isOnline = peer.lastHeartbeat
        ? peer.lastHeartbeat > oneMinuteAgo
        : false;
      const user = peer.userGuid ? userMap.get(peer.userGuid) : null;
      const deviceGroupName =
        (peer.deviceGroup as { name?: string } | null)?.name || '';

      return {
        id: peer.id,
        guid: peer.uuid,
        status: peer.status,
        is_online: isOnline,
        last_online: peer.lastHeartbeat
          ? peer.lastHeartbeat.toISOString()
          : null,
        user: peer.userGuid || '',
        user_name: user?.username || '',
        note: peer.note || '',
        device_group_name: deviceGroupName,
        strategy_name: peer.strategyGuid
          ? strategyMap.get(peer.strategyGuid)?.name || ''
          : '',
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
   * Find a device by UUID
   * @param uuid Device UUID
   * @returns The device entity or null
   */
  async findByUuid(uuid: string): Promise<Peer | null> {
    return this.peerRepository.findOne({ where: { uuid } });
  }
}
