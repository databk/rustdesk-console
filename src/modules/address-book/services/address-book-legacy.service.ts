import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookTag,
  AddressBookPeerTag,
} from '../entities';
import { Sysinfo, Peer } from '../../../common/entities';
import { mapOsToPlatform } from '../../../common/utils/platform.util';

@Injectable()
/**
 * AddressBookLegacyService
 * Sub-service responsible for legacy API compatibility
 *
 * Relationship with the main service:
 * Delegated by AddressBookService to handle legacy API requests
 *
 * Call context:
 * Provides compatibility support for legacy clients
 */
export class AddressBookLegacyService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,
    @InjectRepository(AddressBookPeer)
    private addressBookPeerRepository: Repository<AddressBookPeer>,
    @InjectRepository(AddressBookTag)
    private addressBookTagRepository: Repository<AddressBookTag>,
    @InjectRepository(AddressBookPeerTag)
    private addressBookPeerTagRepository: Repository<AddressBookPeerTag>,
    @InjectRepository(Sysinfo)
    private sysinfoRepository: Repository<Sysinfo>,
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get legacy address book data
   * Returns a format compatible with legacy RustDesk clients
   *
   * Data format description:
   * - If the address book is empty, returns the string "null"
   * - If the address book has data, returns an object containing:
   *   - licensed_devices: number of licensed devices
   *   - data: JSON string containing tags, peers, and tag_colors
   *
   * @param userId User ID
   * @returns Legacy address book data (string or object)
   */
  async getLegacyAddressBook(userId: string) {
    // Get the user's personal address book
    let addressBook = await this.addressBookRepository.findOne({
      where: { owner: userId, isPersonal: true },
    });

    // Create it if it does not exist
    if (!addressBook) {
      addressBook = this.addressBookRepository.create({
        guid: uuidv4(),
        owner: userId,
        name: 'Personal',
        isPersonal: true,
      });
      await this.addressBookRepository.save(addressBook);
    }

    // Get all tags
    const tags = await this.addressBookTagRepository.find({
      where: { addressBookGuid: addressBook.guid },
    });

    // Get all devices and their tags
    const peers = await this.addressBookPeerRepository.find({
      where: { addressBookGuid: addressBook.guid },
      relations: ['tags'],
    });

    // Get all device IDs, used to fetch info from the sysinfos table
    const deviceIds = peers.map((p) => p.deviceId);
    const sysinfos =
      deviceIds.length > 0
        ? await this.sysinfoRepository.find({
            where: { uuid: In(deviceIds) },
          })
        : [];

    const sysinfoMap = new Map(sysinfos.map((s) => [s.uuid, s]));

    // Get device info from the peers table (deviceId references peers.uuid and needs to be resolved to peers.id)
    const peerRecords =
      deviceIds.length > 0
        ? await this.peerRepository.find({
            where: { uuid: In(deviceIds) },
          })
        : [];
    const peerMap = new Map(peerRecords.map((p) => [p.uuid, p]));

    // If the address book is empty, return "null"
    if (tags.length === 0 && peers.length === 0) {
      return 'null';
    }

    // Build the tag color mapping
    const tagColors: Record<string, number> = {};
    for (const tag of tags) {
      tagColors[tag.name] = tag.color;
    }

    // Build the device list
    const peersData = peers.map((p) => {
      const sysinfo = sysinfoMap.get(p.deviceId);
      const peerRecord = peerMap.get(p.deviceId);
      return {
        id: peerRecord?.id || '',
        hash: p.hash || '',
        username: sysinfo?.username || '',
        hostname: sysinfo?.hostname || '',
        platform: mapOsToPlatform(sysinfo?.os),
        alias: p.alias || '',
        tags: p.tags?.map((t) => t.name) || [],
      };
    });

    // Build the tag list
    const tagsList = tags.map((t) => t.name);

    return {
      licensed_devices: 100,
      data: JSON.stringify({
        tags: tagsList,
        peers: peersData,
        tag_colors: JSON.stringify(tagColors),
      }),
    };
  }

  /**
   * Update legacy address book data
   * Receives double JSON-encoded data and updates the database
   *
   * Data format description:
   * The input data contains:
   * - tags: array of tag names
   * - peers: array of devices, each containing id, hash, username, hostname, platform, alias, tags
   * - tag_colors: JSON string containing the tag color mapping
   *
   * Processing logic:
   * 1. Parse the double JSON-encoded data
   * 2. Delete all existing tags and devices
   * 3. Create tags and devices from the new data
   * 4. Establish the associations between devices and tags
   *
   * @param userId User ID
   * @param data Double JSON-encoded address book data
   * @returns Operation result (the string "null")
   * @throws BadRequestException Thrown when the JSON data is invalid
   */
  async updateLegacyAddressBook(userId: string, data: string) {
    if (!data) {
      return 'null';
    }

    // Parse the double JSON-encoded data
    let parsedData: {
      tags?: string[];
      peers?: Array<{
        id: string;
        hash?: string;
        username?: string;
        hostname?: string;
        platform?: string;
        alias?: string;
        tags?: string[];
      }>;
      tag_colors?: string;
    };

    try {
      parsedData = JSON.parse(data) as typeof parsedData;
    } catch {
      throw new BadRequestException('Invalid JSON data');
    }

    // Get the user's personal address book
    let addressBook = await this.addressBookRepository.findOne({
      where: { owner: userId, isPersonal: true },
    });

    // Create it if it does not exist
    if (!addressBook) {
      addressBook = this.addressBookRepository.create({
        guid: uuidv4(),
        owner: userId,
        name: 'Personal',
        isPersonal: true,
      });
      await this.addressBookRepository.save(addressBook);
    }

    const addressBookGuid = addressBook.guid;

    // Parse the tag colors
    let tagColors: Record<string, number> = {};
    if (parsedData.tag_colors) {
      try {
        tagColors = JSON.parse(parsedData.tag_colors) as Record<string, number>;
      } catch {
        // Ignore parse errors
      }
    }

    // Remove only this address book's peer-tag links. The legacy endpoint is
    // user-scoped; an empty delete criteria would erase every user's tags.
    // Run the full replacement inside one transaction so a later write failure
    // rolls back the deletes instead of leaving the address book partially
    // deleted.
    await this.dataSource.transaction(async (manager) => {
      const peerRepository = manager.getRepository(AddressBookPeer);
      const peerTagRepository = manager.getRepository(AddressBookPeerTag);
      const tagRepository = manager.getRepository(AddressBookTag);

      const existingPeers = await peerRepository.find({
        where: { addressBookGuid },
        select: ['guid'],
      });
      if (existingPeers.length > 0) {
        await peerTagRepository.delete({
          peerGuid: In(existingPeers.map((peer) => peer.guid)),
        });
      }
      await tagRepository.delete({ addressBookGuid });
      await peerRepository.delete({ addressBookGuid });

      // Create a new tag
      const tagNameToGuid: Record<string, string> = {};
      const dangerousProperties = ['__proto__', 'constructor', 'prototype'];

      if (parsedData.tags && parsedData.tags.length > 0) {
        for (const tagName of parsedData.tags) {
          if (dangerousProperties.includes(tagName)) {
            continue;
          }

          const tagGuid = uuidv4();
          const tag = tagRepository.create({
            guid: tagGuid,
            addressBookGuid,
            name: tagName,
            color: tagColors[tagName] || 0,
          });
          await tagRepository.save(tag);
          tagNameToGuid[tagName] = tagGuid;
        }
      }

      // Create a new device
      if (parsedData.peers && parsedData.peers.length > 0) {
        for (const peerData of parsedData.peers) {
          // Look up or create the peer record via findOrCreatePeer, using its uuid as deviceId
          // Consistent with the new API: deviceId always references peers.uuid
          const peerRecord = await this.findOrCreatePeer(peerData.id);

          const peerGuid = uuidv4();
          const peer = peerRepository.create({
            guid: peerGuid,
            addressBookGuid,
            deviceId: peerRecord.uuid,
            hash: peerData.hash || '',
            alias: peerData.alias || '',
          });
          await peerRepository.save(peer);

          // Handle tag associations
          if (peerData.tags && peerData.tags.length > 0) {
            for (const tagName of peerData.tags) {
              const tagGuid = tagNameToGuid[tagName];
              if (tagGuid) {
                const peerTag = peerTagRepository.create({
                  peerGuid,
                  tagGuid,
                });
                await peerTagRepository.save(peerTag);
              }
            }
          }
        }
      }
    });

    return 'null';
  }

  /**
   * Find or create a device record
   * Look up the device with the given id in the peers table; create it automatically if not found
   *
   * @param id Device ID (RustDesk numeric ID, IP address, or any format of an existing record)
   * @returns Peer record
   */
  private async findOrCreatePeer(id: string): Promise<Peer> {
    const peerRecord = await this.peerRepository.findOne({
      where: { id },
    });

    if (peerRecord) {
      return peerRecord;
    }

    // For devices not in the peers table, create a peer record automatically
    // This includes IP-format devices (such as 192.168.1.94) and numeric-ID devices that have not sent a heartbeat yet
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
}
