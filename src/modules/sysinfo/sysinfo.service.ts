import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Sysinfo, Peer } from '../../common/entities';
import { SysinfoDto } from './dto/sysinfo.dto';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookTag,
} from '../address-book/entities';
import { DeviceGroup } from '../device-group/entities/device-group.entity';

/**
 * System info service
 * Handles submission and management of device system information
 *
 * Features:
 * - Receive and store device system information
 * - Handle preset address book configuration
 * - Handle preset device group configuration
 * - Automatically add devices to the preset address book and device group
 */
@Injectable()
export class SysinfoService {
  private readonly logger = new Logger(SysinfoService.name);

  constructor(
    @InjectRepository(Sysinfo)
    private sysinfoRepository: Repository<Sysinfo>,
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,
    @InjectRepository(AddressBookPeer)
    private addressBookPeerRepository: Repository<AddressBookPeer>,
    @InjectRepository(AddressBookTag)
    private addressBookTagRepository: Repository<AddressBookTag>,
    @InjectRepository(DeviceGroup)
    private deviceGroupRepository: Repository<DeviceGroup>,
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
  ) {}

  /**
   * Create or update system info
   * Receives system info reported by devices and stores or updates it in the database
   * Only devices registered in the peers table are processed; unregistered devices return ID_NOT_FOUND
   *
   * @param sysinfoDto system info data
   * @returns update result; found being false means the device does not exist in the peers table
   */
  async createSysinfo(
    sysinfoDto: SysinfoDto,
  ): Promise<{ found: boolean; sysinfo?: Sysinfo }> {
    // First check whether the device is registered in the peers table
    const peer = await this.peerRepository.findOne({
      where: { uuid: sysinfoDto.uuid },
    });

    if (!peer) {
      this.logger.debug(
        `Device ${sysinfoDto.uuid} does not exist in the peers table, returning ID_NOT_FOUND`,
      );
      return { found: false };
    }

    // Look up the sysinfos table by uuid to see whether a record already exists
    const existingSysinfo = await this.sysinfoRepository.findOne({
      where: { uuid: sysinfoDto.uuid },
    });

    let sysinfo: Sysinfo;

    if (existingSysinfo) {
      // Exists, update the record
      this.logger.debug(
        `Device ${sysinfoDto.uuid} already exists, updating system info`,
      );

      // Update fields (only fields with values)
      if (sysinfoDto.hostname !== undefined)
        existingSysinfo.hostname = sysinfoDto.hostname;
      if (sysinfoDto.username !== undefined)
        existingSysinfo.username = sysinfoDto.username;
      if (sysinfoDto.os !== undefined) existingSysinfo.os = sysinfoDto.os;
      if (sysinfoDto.cpu !== undefined) existingSysinfo.cpu = sysinfoDto.cpu;
      if (sysinfoDto.memory !== undefined)
        existingSysinfo.memory = sysinfoDto.memory;

      // Update preset fields (if new values are provided)
      if (sysinfoDto['preset-username']) {
        existingSysinfo.presetUsername = sysinfoDto['preset-username'];
      }
      if (sysinfoDto['preset-strategy-name']) {
        existingSysinfo.presetStrategyName = sysinfoDto['preset-strategy-name'];
      }
      if (sysinfoDto['preset-device-group-name']) {
        existingSysinfo.presetDeviceGroupName =
          sysinfoDto['preset-device-group-name'];
      }

      sysinfo = existingSysinfo;
    } else {
      // Does not exist, create a new record
      this.logger.debug(
        `Device ${sysinfoDto.uuid} does not exist, creating new system info`,
      );
      sysinfo = this.sysinfoRepository.create({
        uuid: sysinfoDto.uuid,
        hostname: sysinfoDto.hostname,
        username: sysinfoDto.username,
        os: sysinfoDto.os,
        cpu: sysinfoDto.cpu,
        memory: sysinfoDto.memory,
        presetUsername: sysinfoDto['preset-username'],
        presetStrategyName: sysinfoDto['preset-strategy-name'],
        presetDeviceGroupName: sysinfoDto['preset-device-group-name'],
      });
    }

    const savedSysinfo = await this.sysinfoRepository.save(sysinfo);

    // Handle preset features
    await this.processPresetSettings(savedSysinfo, sysinfoDto);

    return { found: true, sysinfo: savedSysinfo };
  }

  /**
   * Handle preset settings
   * Automatically adds the device to the address book and device group according to the preset configuration
   *
   * @param sysinfo system info object
   * @param dto system info DTO
   * @private
   */
  private async processPresetSettings(
    sysinfo: Sysinfo,
    dto: SysinfoDto,
  ): Promise<void> {
    try {
      // Handle the preset address book
      if (dto['preset-address-book-name']) {
        await this.addToAddressBook(
          sysinfo.uuid,
          sysinfo.hostname,
          dto['preset-address-book-name'],
          dto['preset-address-book-tag'],
          dto['preset-address-book-alias'],
          dto['preset-address-book-password'],
          dto['preset-address-book-note'],
        );
      }

      // Handle the preset device group
      if (sysinfo.presetDeviceGroupName) {
        await this.addToDeviceGroup(sysinfo);
      }

      // Handle the preset note (written directly to Peer.note)
      if (dto['preset-note']) {
        await this.setPresetNote(sysinfo.uuid, dto['preset-note']);
      }
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };
      this.logger.error(
        `Failed to process preset settings: ${err.message ?? String(error)}`,
        err.stack,
      );
    }
  }

  /**
   * Add the device to the preset address book
   * Automatically adds the device to the specified address book according to the preset configuration
   *
   * @param deviceId Device ID
   * @param hostname hostname
   * @param addressBookName address book name
   * @param tag tag (optional)
   * @param alias alias (optional)
   * @param password password (optional)
   * @param note note (optional)
   * @private
   */
  private async addToAddressBook(
    deviceId: string,
    hostname: string,
    addressBookName: string,
    tag?: string,
    alias?: string,
    password?: string,
    note?: string,
  ): Promise<void> {
    // Find or create the address book
    const addressBook = await this.addressBookRepository.findOne({
      where: { name: addressBookName },
    });

    if (!addressBook) {
      // If the address book does not exist, skip the addition
      this.logger.warn(
        `Preset address book "${addressBookName}" does not exist, skipping device addition`,
      );
      return;
    }

    // Check whether the device already exists in the address book
    const existingPeer = await this.addressBookPeerRepository.findOne({
      where: { deviceId: deviceId, addressBookGuid: addressBook.guid },
    });

    if (existingPeer) {
      this.logger.debug(
        `Device ${deviceId} already exists in address book ${addressBook.name}`,
      );
      return;
    }

    // Handle preset tags (collect existing tags, do not create automatically)
    const existingTags: AddressBookTag[] = [];
    if (tag) {
      const tagNames = tag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t);

      // Find existing tags
      for (const tagName of tagNames) {
        const existingTag = await this.addressBookTagRepository.findOne({
          where: { name: tagName, addressBookGuid: addressBook.guid },
        });

        if (existingTag) {
          existingTags.push(existingTag);
        } else {
          this.logger.warn(
            `Tag "${tagName}" does not exist in address book ${addressBook.name}, skipping`,
          );
        }
      }
    }

    // Create the device record and bind tags
    const peerGuid = uuidv4();
    const peer = this.addressBookPeerRepository.create({
      guid: peerGuid,
      addressBookGuid: addressBook.guid,
      deviceId: deviceId,
      alias: alias || hostname,
      password: password,
      note: note,
      tags: existingTags,
    });

    await this.addressBookPeerRepository.save(peer);
    this.logger.log(
      `Device ${deviceId} added to address book ${addressBook.name}${existingTags.length > 0 ? `, bound tags: ${existingTags.map((t) => t.name).join(', ')}` : ''}`,
    );
  }

  /**
   * Add the device to the preset device group
   * Automatically links the device to the specified device group according to the preset configuration
   *
   * @param sysinfo system info object
   * @private
   */
  private async addToDeviceGroup(sysinfo: Sysinfo): Promise<void> {
    // Find the device group
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { name: sysinfo.presetDeviceGroupName },
    });

    if (!deviceGroup) {
      this.logger.warn(
        `Preset device group "${sysinfo.presetDeviceGroupName}" does not exist, skipping device addition`,
      );
      return;
    }

    // Find the device record
    const peer = await this.peerRepository.findOne({
      where: { uuid: sysinfo.uuid },
    });

    if (peer) {
      // Update the device device group
      await this.peerRepository.update(
        { uuid: sysinfo.uuid },
        { deviceGroupGuid: deviceGroup.guid },
      );
      this.logger.log(
        `Device ${sysinfo.uuid} linked to device group ${deviceGroup.name}`,
      );
    } else {
      this.logger.warn(
        `Device ${sysinfo.uuid} does not exist, cannot link to device group`,
      );
    }
  }

  /**
   * Set the preset note
   * Writes the preset note provided by the client to Peer.note
   * Only written when the device has no note yet; existing notes are not overwritten
   *
   * @param uuid Device UUID
   * @param presetNote preset note
   * @private
   */
  private async setPresetNote(uuid: string, presetNote: string): Promise<void> {
    const peer = await this.peerRepository.findOne({
      where: { uuid },
    });

    if (peer) {
      if (!peer.note) {
        await this.peerRepository.update({ uuid }, { note: presetNote });
        this.logger.log(`Device ${uuid} preset note set: ${presetNote}`);
      } else {
        this.logger.debug(
          `Device ${uuid} already has a note, skipping preset note`,
        );
      }
    } else {
      this.logger.warn(`Device ${uuid} does not exist, cannot set preset note`);
    }
  }
}
