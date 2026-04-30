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
        presetUsername: sysinfoDto['preset-username'],
        presetStrategyName: sysinfoDto['preset-strategy-name'],
        presetDeviceGroupName: sysinfoDto['preset-device-group-name'],
        presetNote: sysinfoDto['preset-note'],
      });
    }

    const savedSysinfo = await this.sysinfoRepository.save(sysinfo);

    // 处理预设功能
    await this.processPresetSettings(savedSysinfo, sysinfoDto);

    return savedSysinfo;
  }

  /**
   * 处理预设设置
   * 根据预设配置自动添加设备到地址簿和设备组
   *
   * @param sysinfo 系统信息对象
   * @param dto 系统信息DTO
   * @private
   */
  private async processPresetSettings(
    sysinfo: Sysinfo,
    dto: SysinfoDto,
  ): Promise<void> {
    try {
      // 处理预设地址簿
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
   * @param deviceId 设备ID
   * @param hostname 主机名
   * @param addressBookName 地址簿名称
   * @param tag 标签（可选）
   * @param alias 别名（可选）
   * @param password 密码（可选）
   * @param note 备注（可选）
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
    // 查找或创建地址簿
    const addressBook = await this.addressBookRepository.findOne({
      where: { name: addressBookName },
    });

    if (!addressBook) {
      // 如果地址簿不存在，跳过添加
      this.logger.warn(
        `预设地址簿 "${addressBookName}" 不存在，跳过添加设备`,
      );
      return;
    }

    // 检查设备是否已存在于地址簿
    const existingPeer = await this.addressBookPeerRepository.findOne({
      where: { deviceId: deviceId, addressBookGuid: addressBook.guid },
    });

    if (existingPeer) {
      this.logger.debug(
        `设备 ${deviceId} 已存在于地址簿 ${addressBook.name}`,
      );
      return;
    }

    // 处理预设标签
    let tags: string[] = [];
    if (tag) {
      tags = tag
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
      deviceId: deviceId,
      alias: alias || hostname,
      password: password,
      note: note,
    });

    await this.addressBookPeerRepository.save(peer);
    this.logger.log(`设备 ${deviceId} 已添加到地址簿 ${addressBook.name}`);
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
