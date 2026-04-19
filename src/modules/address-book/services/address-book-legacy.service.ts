import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookTag,
  AddressBookPeerTag,
} from '../entities';
import { Sysinfo } from '../../../common/entities';

@Injectable()
/**
 * AddressBookLegacyService
 * 负责旧版API兼容的子服务
 *
 * 与主服务关系：
 * 被AddressBookService委托处理旧版API请求
 *
 * 调用上下文：
 * 提供与旧版客户端的兼容性支持
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
  ) {}

  /**
   * 获取旧版地址簿数据
   * 返回格式兼容旧版RustDesk客户端
   *
   * 数据格式说明：
   * - 如果地址簿为空，返回字符串 "null"
   * - 如果地址簿有数据，返回对象包含：
   *   - licensed_devices: 许可设备数量
   *   - data: JSON字符串，包含tags、peers、tag_colors
   *
   * @param userId 用户ID
   * @returns 旧版地址簿数据（字符串或对象）
   */
  async getLegacyAddressBook(userId: string) {
    // 获取用户的个人地址簿
    let addressBook = await this.addressBookRepository.findOne({
      where: { owner: userId, isPersonal: true },
    });

    // 如果不存在则创建
    if (!addressBook) {
      addressBook = this.addressBookRepository.create({
        guid: uuidv4(),
        owner: userId,
        name: 'Personal',
        isPersonal: true,
      });
      await this.addressBookRepository.save(addressBook);
    }

    // 获取所有标签
    const tags = await this.addressBookTagRepository.find({
      where: { addressBookGuid: addressBook.guid },
    });

    // 获取所有设备及其标签
    const peers = await this.addressBookPeerRepository.find({
      where: { addressBookGuid: addressBook.guid },
      relations: ['tags'],
    });

    // 获取所有设备ID，用于从sysinfos表获取信息
    const deviceIds = peers.map((p) => p.deviceId);
    const sysinfos =
      deviceIds.length > 0
        ? await this.sysinfoRepository.find({
            where: { uuid: In(deviceIds) },
          })
        : [];

    const sysinfoMap = new Map(sysinfos.map((s) => [s.uuid, s]));

    // 如果地址簿为空，返回 "null"
    if (tags.length === 0 && peers.length === 0) {
      return 'null';
    }

    // 构建标签颜色映射
    const tagColors: Record<string, number> = {};
    for (const tag of tags) {
      tagColors[tag.name] = tag.color;
    }

    // 构建设备列表
    const peersData = peers.map((p) => {
      const sysinfo = sysinfoMap.get(p.deviceId);
      return {
        id: p.deviceId,
        hash: p.hash || '',
        username: sysinfo?.username || '',
        hostname: sysinfo?.hostname || '',
        platform: sysinfo?.os || '',
        alias: p.alias || '',
        tags: p.tags?.map((t) => t.name) || [],
      };
    });

    // 构建标签列表
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
   * 更新旧版地址簿数据
   * 接收双重JSON编码的数据，并更新到数据库
   *
   * 数据格式说明：
   * 输入数据包含：
   * - tags: 标签名称数组
   * - peers: 设备数组，每个设备包含id、hash、username、hostname、platform、alias、tags
   * - tag_colors: JSON字符串，包含标签颜色映射
   *
   * 处理逻辑：
   * 1. 解析双重JSON编码的数据
   * 2. 删除现有所有标签和设备
   * 3. 根据新数据创建标签和设备
   * 4. 建立设备与标签的关联关系
   *
   * @param userId 用户ID
   * @param data 双重JSON编码的地址簿数据
   * @returns 操作结果（字符串 "null"）
   * @throws BadRequestException 当JSON数据无效时抛出
   */
  async updateLegacyAddressBook(userId: string, data: string) {
    if (!data) {
      return 'null';
    }

    // 解析双重 JSON 编码的数据
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
      throw new BadRequestException('无效的 JSON 数据');
    }

    // 获取用户的个人地址簿
    let addressBook = await this.addressBookRepository.findOne({
      where: { owner: userId, isPersonal: true },
    });

    // 如果不存在则创建
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

    // 解析标签颜色
    let tagColors: Record<string, number> = {};
    if (parsedData.tag_colors) {
      try {
        tagColors = JSON.parse(parsedData.tag_colors) as Record<string, number>;
      } catch {
        // 忽略解析错误
      }
    }

    // 删除所有现有标签和设备
    await this.addressBookPeerTagRepository.delete({});
    await this.addressBookTagRepository.delete({ addressBookGuid });
    await this.addressBookPeerRepository.delete({ addressBookGuid });

    // 创建新标签
    const tagNameToGuid: Record<string, string> = {};
    if (parsedData.tags && parsedData.tags.length > 0) {
      for (const tagName of parsedData.tags) {
        const tagGuid = uuidv4();
        const tag = this.addressBookTagRepository.create({
          guid: tagGuid,
          addressBookGuid,
          name: tagName,
          color: tagColors[tagName] || 0,
        });
        await this.addressBookTagRepository.save(tag);
        tagNameToGuid[tagName] = tagGuid;
      }
    }

    // 创建新设备
    if (parsedData.peers && parsedData.peers.length > 0) {
      for (const peerData of parsedData.peers) {
        const peerGuid = uuidv4();
        const peer = this.addressBookPeerRepository.create({
          guid: peerGuid,
          addressBookGuid,
          deviceId: peerData.id,
          hash: peerData.hash || '',
          alias: peerData.alias || '',
        });
        await this.addressBookPeerRepository.save(peer);

        // 处理标签关联
        if (peerData.tags && peerData.tags.length > 0) {
          for (const tagName of peerData.tags) {
            const tagGuid = tagNameToGuid[tagName];
            if (tagGuid) {
              const peerTag = this.addressBookPeerTagRepository.create({
                peerGuid,
                tagGuid,
              });
              await this.addressBookPeerTagRepository.save(peerTag);
            }
          }
        }
      }
    }

    return 'null';
  }
}
