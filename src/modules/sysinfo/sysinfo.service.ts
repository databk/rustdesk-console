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
 * 系统信息服务
 * 负责处理设备的系统信息提交和管理
 *
 * 功能：
 * - 接收和存储设备系统信息
 * - 处理预设地址簿配置
 * - 处理预设设备组配置
 * - 自动添加设备到预设地址簿和设备组
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
   * 创建或更新系统信息
   * 接收设备上报的系统信息，存储或更新到数据库
   *
   * @param sysinfoDto 系统信息数据
   * @returns 保存的系统信息记录
   */
  async createSysinfo(sysinfoDto: SysinfoDto): Promise<Sysinfo> {
    // 根据uuid查找是否已存在记录
    const existingSysinfo = await this.sysinfoRepository.findOne({
      where: { uuid: sysinfoDto.uuid },
    });

    let sysinfo: Sysinfo;

    if (existingSysinfo) {
      // 已存在，更新记录
      this.logger.debug(`设备 ${sysinfoDto.uuid} 已存在，更新系统信息`);

      // 更新字段（只更新有值的字段）
      if (sysinfoDto.hostname !== undefined)
        existingSysinfo.hostname = sysinfoDto.hostname;
      if (sysinfoDto.username !== undefined)
        existingSysinfo.username = sysinfoDto.username;
      if (sysinfoDto.os !== undefined) existingSysinfo.os = sysinfoDto.os;
      if (sysinfoDto.cpu !== undefined) existingSysinfo.cpu = sysinfoDto.cpu;
      if (sysinfoDto.memory !== undefined)
        existingSysinfo.memory = sysinfoDto.memory;

      // 更新预设字段（如果提供了新值）
      if (sysinfoDto['preset-address-book-name']) {
        existingSysinfo.presetAddressBookName =
          sysinfoDto['preset-address-book-name'];
      }
      if (sysinfoDto['preset-address-book-tag']) {
        existingSysinfo.presetAddressBookTag =
          sysinfoDto['preset-address-book-tag'];
      }
      if (sysinfoDto['preset-address-book-alias']) {
        existingSysinfo.presetAddressBookAlias =
          sysinfoDto['preset-address-book-alias'];
      }
      if (sysinfoDto['preset-address-book-password']) {
        existingSysinfo.presetAddressBookPassword =
          sysinfoDto['preset-address-book-password'];
      }
      if (sysinfoDto['preset-address-book-note']) {
        existingSysinfo.presetAddressBookNote =
          sysinfoDto['preset-address-book-note'];
      }
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
      if (sysinfoDto['preset-note']) {
        existingSysinfo.presetNote = sysinfoDto['preset-note'];
      }

      sysinfo = existingSysinfo;
    } else {
      // 不存在，创建新记录
      this.logger.debug(`设备 ${sysinfoDto.uuid} 不存在，创建新系统信息`);
      sysinfo = this.sysinfoRepository.create({
        uuid: sysinfoDto.uuid,
        hostname: sysinfoDto.hostname,
        username: sysinfoDto.username,
        os: sysinfoDto.os,
        cpu: sysinfoDto.cpu,
        memory: sysinfoDto.memory,
        presetAddressBookName: sysinfoDto['preset-address-book-name'],
        presetAddressBookTag: sysinfoDto['preset-address-book-tag'],
        presetAddressBookAlias: sysinfoDto['preset-address-book-alias'],
        presetAddressBookPassword: sysinfoDto['preset-address-book-password'],
        presetAddressBookNote: sysinfoDto['preset-address-book-note'],
        presetUsername: sysinfoDto['preset-username'],
        presetStrategyName: sysinfoDto['preset-strategy-name'],
        presetDeviceGroupName: sysinfoDto['preset-device-group-name'],
        presetNote: sysinfoDto['preset-note'],
      });
    }

    const savedSysinfo = await this.sysinfoRepository.save(sysinfo);

    // 处理预设功能
    await this.processPresetSettings(savedSysinfo);

    return savedSysinfo;
  }

  /**
   * 处理预设设置
   * 根据预设配置自动添加设备到地址簿和设备组
   *
   * @param sysinfo 系统信息对象
   * @private
   */
  private async processPresetSettings(sysinfo: Sysinfo): Promise<void> {
    try {
      // 处理预设地址簿
      if (sysinfo.presetAddressBookName) {
        await this.addToAddressBook(sysinfo);
      }

      // 处理预设设备组
      if (sysinfo.presetDeviceGroupName) {
        await this.addToDeviceGroup(sysinfo);
      }
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };
      this.logger.error(
        `处理预设设置失败: ${err.message ?? String(error)}`,
        err.stack,
      );
    }
  }

  /**
   * 将设备添加到预设地址簿
   * 根据预设配置自动将设备添加到指定的地址簿
   *
   * @param sysinfo 系统信息对象
   * @private
   */
  private async addToAddressBook(sysinfo: Sysinfo): Promise<void> {
    // 查找或创建地址簿
    const addressBook = await this.addressBookRepository.findOne({
      where: { name: sysinfo.presetAddressBookName },
    });

    if (!addressBook) {
      // 如果地址簿不存在，跳过添加
      this.logger.warn(
        `预设地址簿 "${sysinfo.presetAddressBookName}" 不存在，跳过添加设备`,
      );
      return;
    }

    // 检查设备是否已存在于地址簿
    const existingPeer = await this.addressBookPeerRepository.findOne({
      where: { deviceId: sysinfo.uuid, addressBookGuid: addressBook.guid },
    });

    if (existingPeer) {
      this.logger.debug(
        `设备 ${sysinfo.uuid} 已存在于地址簿 ${addressBook.name}`,
      );
      return;
    }

    // 处理预设标签
    let tags: string[] = [];
    if (sysinfo.presetAddressBookTag) {
      tags = sysinfo.presetAddressBookTag
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t);

      // 确保标签存在
      for (const tagName of tags) {
        const existingTag = await this.addressBookTagRepository.findOne({
          where: { name: tagName, addressBookGuid: addressBook.guid },
        });

        if (!existingTag) {
          const newTag = this.addressBookTagRepository.create({
            guid: uuidv4(),
            addressBookGuid: addressBook.guid,
            name: tagName,
            color: 0,
          });
          await this.addressBookTagRepository.save(newTag);
          this.logger.log(`创建标签: ${tagName}`);
        }
      }
    }

    // 创建设备记录
    const peerGuid = uuidv4();
    const peer = this.addressBookPeerRepository.create({
      guid: peerGuid,
      addressBookGuid: addressBook.guid,
      deviceId: sysinfo.uuid,
      alias: sysinfo.presetAddressBookAlias || sysinfo.hostname,
      password: sysinfo.presetAddressBookPassword,
      note: sysinfo.presetAddressBookNote || sysinfo.presetNote,
    });

    await this.addressBookPeerRepository.save(peer);
    this.logger.log(`设备 ${sysinfo.uuid} 已添加到地址簿 ${addressBook.name}`);
  }

  /**
   * 将设备添加到预设设备组
   * 根据预设配置自动将设备关联到指定的设备组
   *
   * @param sysinfo 系统信息对象
   * @private
   */
  private async addToDeviceGroup(sysinfo: Sysinfo): Promise<void> {
    // 查找设备组
    const deviceGroup = await this.deviceGroupRepository.findOne({
      where: { name: sysinfo.presetDeviceGroupName },
    });

    if (!deviceGroup) {
      this.logger.warn(
        `预设设备组 "${sysinfo.presetDeviceGroupName}" 不存在，跳过添加设备`,
      );
      return;
    }

    // 查找设备记录
    const peer = await this.peerRepository.findOne({
      where: { uuid: sysinfo.uuid },
    });

    if (peer) {
      // 更新设备的设备组
      peer.deviceGroupGuid = deviceGroup.guid;
      await this.peerRepository.save(peer);
      this.logger.log(
        `设备 ${sysinfo.uuid} 已关联到设备组 ${deviceGroup.name}`,
      );
    } else {
      this.logger.warn(`设备 ${sysinfo.uuid} 不存在，无法关联到设备组`);
    }
  }
}
