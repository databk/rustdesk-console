import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookPeerTag,
  ShareRule,
} from '../entities';
import { AddPeerDto, UpdatePeerDto, PeersQueryDto, TagMatchMode } from '../dto';
import { Sysinfo, Peer } from '../../../common/entities';
import { mapOsToPlatform } from '../../../common/utils/platform.util';
import { isIpDevice } from '../../../common/utils/ip.util';

@Injectable()
/**
 * AddressBookPeerService
 * Sub-service responsible for device management in the address book
 *
 * Relationship with the main service:
 * Delegated by AddressBookService to handle device-related operations
 *
 * Call context:
 * Includes adding, updating, deleting, and querying devices
 */
export class AddressBookPeerService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,
    @InjectRepository(AddressBookPeer)
    private addressBookPeerRepository: Repository<AddressBookPeer>,
    @InjectRepository(AddressBookPeerTag)
    private addressBookPeerTagRepository: Repository<AddressBookPeerTag>,
    @InjectRepository(Sysinfo)
    private sysinfoRepository: Repository<Sysinfo>,
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
  ) {}

  /**
   * Get the device list of the address book
   * Query all devices in the specified address book, joining device details and system information
   *
   * @param query Query parameters, including pagination and the address book GUID
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @returns Device list and total count
   * @throws NotFoundException Thrown when the address book does not exist
   */
  async getPeers(
    query: PeersQueryDto,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    const {
      current = 1,
      pageSize = 100,
      ab,
      id,
      alias,
      tags,
      tagMode = TagMatchMode.UNION,
    } = query;
    const skip = (current - 1) * pageSize;

    const addressBook = await this.addressBookRepository.findOne({
      where: { guid: ab },
    });

    if (!addressBook) {
      throw new NotFoundException('Address book does not exist');
    }

    // If a user ID is provided, verify access permission
    if (userId && checkAccess) {
      await checkAccess(ab, userId, ShareRule.READ);
    }

    const queryBuilder = this.addressBookPeerRepository
      .createQueryBuilder('abp')
      .leftJoinAndSelect('abp.tags', 'tags')
      .where('abp.addressBookGuid = :addressBookGuid', { addressBookGuid: ab });

    // Filter by alias (fuzzy match)
    if (alias) {
      queryBuilder.andWhere('abp.alias LIKE :alias', { alias: `%${alias}%` });
    }

    // Filter by device ID (fuzzy match) - using a subquery
    if (id) {
      queryBuilder.andWhere(
        `abp.deviceId IN (
          SELECT uuid FROM peers WHERE id LIKE :id
        )`,
        { id: `%${id}%` },
      );
    }

    // Filter by tag (exact match)
    if (tags && tags.length > 0) {
      if (tagMode === TagMatchMode.INTERSECTION) {
        // Intersection mode: must contain all tags
        queryBuilder.andWhere(
          `abp.guid IN (
            SELECT apt.peerGuid 
            FROM address_book_peer_tags apt
            JOIN address_book_tags t ON apt.tagGuid = t.guid
            WHERE t.addressBookGuid = :addressBookGuid AND t.name IN (:...tagNames)
            GROUP BY apt.peerGuid
            HAVING COUNT(DISTINCT t.name) = :tagCount
          )`,
          { tagNames: tags, tagCount: tags.length },
        );
      } else {
        // Union mode (default): matching any one tag is sufficient
        queryBuilder.andWhere(
          `abp.guid IN (
            SELECT DISTINCT apt.peerGuid 
            FROM address_book_peer_tags apt
            JOIN address_book_tags t ON apt.tagGuid = t.guid
            WHERE t.addressBookGuid = :addressBookGuid AND t.name IN (:...tagNames)
          )`,
          { tagNames: tags },
        );
      }
    }

    const [peers, total] = await queryBuilder
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    // Get all device IDs (uuid), used to fetch info from the peers and sysinfos tables
    const deviceIds = peers.map((p) => p.deviceId);

    // Get the RustDesk ID from the peers table
    const peerRecords =
      deviceIds.length > 0
        ? await this.peerRepository.find({
            where: { uuid: In(deviceIds) },
          })
        : [];
    const peerMap = new Map(peerRecords.map((p) => [p.uuid, p]));

    // Get device info from the sysinfos table
    const sysinfos =
      deviceIds.length > 0
        ? await this.sysinfoRepository.find({
            where: { uuid: In(deviceIds) },
          })
        : [];
    const sysinfoMap = new Map(sysinfos.map((s) => [s.uuid, s]));

    // Assemble the response data
    const data = peers.map((p) => {
      const peerRecord = peerMap.get(p.deviceId);
      const sysinfo = sysinfoMap.get(p.deviceId);
      return {
        id: peerRecord?.id || '', // Return the RustDesk ID
        hash: p.hash,
        password: p.password,
        username: sysinfo?.username || '',
        hostname: sysinfo?.hostname || '',
        platform: mapOsToPlatform(sysinfo?.os),
        alias: p.alias,
        tags: p.tags?.map((t) => t.name) || [],
        note: p.note,
      };
    });

    return { total, data };
  }

  /**
   * Add a device to the address book
   * Add a device to the specified address book, with optional tag association
   *
   * @param addressBookGuid Address book GUID
   * @param dto Device information DTO, containing device ID, password, alias, tags, etc.
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @param getOrCreateTag Function to get or create a tag (optional)
   * @returns Operation result
   * @throws NotFoundException Thrown when the address book or device does not exist
   * @throws BadRequestException Thrown when the device already exists in the address book
   */
  async addPeer(
    addressBookGuid: string,
    dto: AddPeerDto,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
    getOrCreateTag?: (
      addressBookGuid: string,
      tagName: string,
    ) => Promise<string>,
  ) {
    // If a user ID is provided, verify write permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    const addressBook = await this.addressBookRepository.findOne({
      where: { guid: addressBookGuid },
    });

    if (!addressBook) {
      throw new NotFoundException('Address book does not exist');
    }

    // Look up the peers table by the id sent by the client to get the uuid (deviceId)
    // For IP-format devices, create the record automatically if it is not in the peers table
    const peerRecord = await this.findOrCreatePeer(dto.id);

    const deviceId = peerRecord.uuid;

    // Check whether the device already exists in the address book
    const existingPeer = await this.addressBookPeerRepository.findOne({
      where: { deviceId, addressBookGuid },
    });

    if (existingPeer) {
      throw new BadRequestException(
        'Device already exists in the address book',
      );
    }

    // Create the device record
    const peerGuid = uuidv4();
    const peer = this.addressBookPeerRepository.create({
      guid: peerGuid,
      addressBookGuid,
      deviceId,
      hash: dto.hash,
      password: dto.password,
      alias: dto.alias,
      note: dto.note,
    });

    await this.addressBookPeerRepository.save(peer);

    // Handle tag associations - dto.tags is an array of tag names
    if (dto.tags && dto.tags.length > 0 && getOrCreateTag) {
      for (const tagName of dto.tags) {
        const tagGuid = await getOrCreateTag(addressBookGuid, tagName);
        const peerTag = this.addressBookPeerTagRepository.create({
          peerGuid,
          tagGuid,
        });
        await this.addressBookPeerTagRepository.save(peerTag);
      }
    }

    return {};
  }

  /**
   * Update device information in the address book
   * Update the device's password, alias, remarks, and tag associations
   *
   * @param addressBookGuid Address book GUID
   * @param dto Device update information DTO
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @param getOrCreateTag Function to get or create a tag (optional)
   * @returns Operation result
   * @throws NotFoundException Thrown when the device does not exist
   */
  async updatePeer(
    addressBookGuid: string,
    dto: UpdatePeerDto,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
    getOrCreateTag?: (
      addressBookGuid: string,
      tagName: string,
    ) => Promise<string>,
  ) {
    // If a user ID is provided, verify write permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    // Look up the peers table by the id sent by the client to get the uuid (deviceId)
    // For IP-format devices, create the record automatically if it is not in the peers table
    const peerRecord = await this.findOrCreatePeer(dto.id);

    const deviceId = peerRecord.uuid;

    // Look up the device in the address book by deviceId
    const peer = await this.addressBookPeerRepository.findOne({
      where: { deviceId, addressBookGuid },
    });

    if (!peer) {
      throw new NotFoundException('Device does not exist in this address book');
    }

    // Build the update data
    const updateData: Partial<AddressBookPeer> = {};

    if (dto.hash !== undefined) updateData.hash = dto.hash;
    if (dto.password !== undefined) updateData.password = dto.password;
    if (dto.alias !== undefined) updateData.alias = dto.alias;
    if (dto.note !== undefined) updateData.note = dto.note;

    await this.addressBookPeerRepository.update(
      { guid: peer.guid },
      updateData,
    );

    // Update tag associations - dto.tags is an array of tag names
    if (dto.tags !== undefined) {
      // Delete the old tag associations
      await this.addressBookPeerTagRepository.delete({ peerGuid: peer.guid });

      // Add the new tag associations
      if (dto.tags.length > 0 && getOrCreateTag) {
        for (const tagName of dto.tags) {
          const tagGuid = await getOrCreateTag(addressBookGuid, tagName);
          const peerTag = this.addressBookPeerTagRepository.create({
            peerGuid: peer.guid,
            tagGuid,
          });
          await this.addressBookPeerTagRepository.save(peerTag);
        }
      }
    }

    return {};
  }

  /**
   * Delete devices from the address book
   * Batch delete devices from the specified address book, also removing tag associations
   *
   * @param addressBookGuid Address book GUID
   * @param ids List of device IDs to delete (RustDesk IDs)
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @returns Operation result
   * @throws BadRequestException Thrown when no device IDs are provided
   */
  async deletePeers(
    addressBookGuid: string,
    ids: string[],
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    // If a user ID is provided, verify write permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    if (!ids || ids.length === 0) {
      throw new BadRequestException('Please provide the device IDs to delete');
    }

    // ids is an array of RustDesk IDs; the corresponding uuids need to be looked up first
    const peerRecords = await this.peerRepository.find({
      where: { id: In(ids) },
    });

    const deviceIds = peerRecords.map((p) => p.uuid);

    if (deviceIds.length > 0) {
      // Delete by deviceId (tag associations are cascade-deleted automatically)
      await this.addressBookPeerRepository.delete({
        deviceId: In(deviceIds),
        addressBookGuid,
      });
    }

    return {};
  }

  /**
   * Find or create a device record
   * Look up the device with the given id in the peers table; if not found and the id is in IP format, create it automatically
   *
   * @param id Device ID (RustDesk numeric ID or IP address)
   * @returns Peer record
   * @throws NotFoundException Thrown when the device does not exist and the id is not in IP format
   */
  private async findOrCreatePeer(id: string): Promise<Peer> {
    const peerRecord = await this.peerRepository.findOne({
      where: { id },
    });

    if (peerRecord) {
      return peerRecord;
    }

    // For IP-format devices (such as 192.168.1.94 or 192.168.1.94:21118),
    // create a peer record automatically, since these devices are reached via direct IP and do not register through heartbeats
    if (isIpDevice(id)) {
      const newPeer = this.peerRepository.create({
        uuid: uuidv4(),
        id,
        ver: 0,
        modifiedAt: 0,
        lastHeartbeat: null,
      });
      await this.peerRepository.save(newPeer);
      return newPeer;
    }

    throw new NotFoundException('Device does not exist');
  }
}
