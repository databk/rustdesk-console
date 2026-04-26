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

@Injectable()
/**
 * AddressBookPeerService
 * 负责地址簿中设备管理的子服务
 *
 * 与主服务关系：
 * 被AddressBookService委托处理设备相关操作
 *
 * 调用上下文：
 * 包括设备的添加、更新、删除和查询
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
   * 获取地址簿中的设备列表
   * 查询指定地址簿中的所有设备，并关联查询设备详细信息和系统信息
   *
   * @param query 查询参数，包含分页和地址簿GUID
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @returns 设备列表和总数
   * @throws NotFoundException 当地址簿不存在时抛出
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
    const { current = 1, pageSize = 100, ab, id, alias, tags, tagMode = TagMatchMode.UNION } = query;
    const skip = (current - 1) * pageSize;

    const addressBook = await this.addressBookRepository.findOne({
      where: { guid: ab },
    });

    if (!addressBook) {
      throw new NotFoundException('地址簿不存在');
    }

    // 如果提供了用户ID，验证访问权限
    if (userId && checkAccess) {
      await checkAccess(ab, userId, ShareRule.READ);
    }

    const queryBuilder = this.addressBookPeerRepository
      .createQueryBuilder('abp')
      .leftJoinAndSelect('abp.tags', 'tags')
      .where('abp.addressBookGuid = :addressBookGuid', { addressBookGuid: ab });

    // 按别名过滤（模糊匹配）
    if (alias) {
      queryBuilder.andWhere('abp.alias LIKE :alias', { alias: `%${alias}%` });
    }

    // 按设备ID过滤（模糊匹配）- 使用子查询
    if (id) {
      queryBuilder.andWhere(
        `abp.deviceId IN (
          SELECT uuid FROM peers WHERE id LIKE :id
        )`,
        { id: `%${id}%` },
      );
    }

    // 按标签过滤（精确匹配）
    if (tags && tags.length > 0) {
      if (tagMode === TagMatchMode.INTERSECTION) {
        // 交集模式：必须包含所有标签
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
        // 并集模式（默认）：匹配任意一个标签即可
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

    // 获取所有设备ID (uuid)，用于从 peers 表和 sysinfos 表获取信息
    const deviceIds = peers.map((p) => p.deviceId);

    // 从 peers 表获取 RustDesk ID
    const peerRecords =
      deviceIds.length > 0
        ? await this.peerRepository.find({
            where: { uuid: In(deviceIds) },
          })
        : [];
    const peerMap = new Map(peerRecords.map((p) => [p.uuid, p]));

    // 从 sysinfos 表获取设备信息
    const sysinfos =
      deviceIds.length > 0
        ? await this.sysinfoRepository.find({
            where: { uuid: In(deviceIds) },
          })
        : [];
    const sysinfoMap = new Map(sysinfos.map((s) => [s.uuid, s]));

    // 组装返回数据
    const data = peers.map((p) => {
      const peerRecord = peerMap.get(p.deviceId);
      const sysinfo = sysinfoMap.get(p.deviceId);
      return {
        id: peerRecord?.id || '', // 返回 RustDesk ID
        hash: p.hash,
        password: p.password,
        username: sysinfo?.username || '',
        hostname: sysinfo?.hostname || '',
        platform: sysinfo?.os || '',
        alias: p.alias,
        tags: p.tags?.map((t) => t.name) || [],
        note: p.note,
      };
    });

    return { total, data };
  }

  /**
   * 添加设备到地址簿
   * 将设备添加到指定地址簿，支持关联标签
   *
   * @param addressBookGuid 地址簿GUID
   * @param dto 设备信息DTO，包含设备ID、密码、别名、标签等
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @param getOrCreateTag 获取或创建标签的函数（可选）
   * @returns 操作结果
   * @throws NotFoundException 当地址簿或设备不存在时抛出
   * @throws BadRequestException 当设备已存在于地址簿中时抛出
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
    // 如果提供了用户ID，验证写权限
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    const addressBook = await this.addressBookRepository.findOne({
      where: { guid: addressBookGuid },
    });

    if (!addressBook) {
      throw new NotFoundException('地址簿不存在');
    }

    // 通过客户端发送的 id 查找 peers 表获取 uuid (deviceId)
    const peerRecord = await this.peerRepository.findOne({
      where: { id: dto.id },
    });

    if (!peerRecord) {
      throw new NotFoundException('设备不存在');
    }

    const deviceId = peerRecord.uuid;

    // 检查设备是否已存在于地址簿
    const existingPeer = await this.addressBookPeerRepository.findOne({
      where: { deviceId, addressBookGuid },
    });

    if (existingPeer) {
      throw new BadRequestException('设备已存在于地址簿中');
    }

    // 创建设备记录
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

    // 处理标签关联 - dto.tags 是标签名称数组
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
   * 更新地址簿中的设备信息
   * 更新设备的密码、别名、备注和标签关联
   *
   * @param addressBookGuid 地址簿GUID
   * @param dto 设备更新信息DTO
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @param getOrCreateTag 获取或创建标签的函数（可选）
   * @returns 操作结果
   * @throws NotFoundException 当设备不存在时抛出
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
    // 如果提供了用户ID，验证写权限
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    // 通过客户端发送的 id 查找 peers 表获取 uuid (deviceId)
    const peerRecord = await this.peerRepository.findOne({
      where: { id: dto.id },
    });

    if (!peerRecord) {
      throw new NotFoundException('设备不存在');
    }

    const deviceId = peerRecord.uuid;

    // 根据 deviceId 查找地址簿中的设备
    const peer = await this.addressBookPeerRepository.findOne({
      where: { deviceId, addressBookGuid },
    });

    if (!peer) {
      throw new NotFoundException('设备不存在于此地址簿');
    }

    // 构建更新数据
    const updateData: Partial<AddressBookPeer> = {};

    if (dto.hash !== undefined) updateData.hash = dto.hash;
    if (dto.password !== undefined) updateData.password = dto.password;
    if (dto.alias !== undefined) updateData.alias = dto.alias;
    if (dto.note !== undefined) updateData.note = dto.note;

    await this.addressBookPeerRepository.update(
      { guid: peer.guid },
      updateData,
    );

    // 更新标签关联 - dto.tags 是标签名称数组
    if (dto.tags !== undefined) {
      // 删除旧的标签关联
      await this.addressBookPeerTagRepository.delete({ peerGuid: peer.guid });

      // 添加新的标签关联
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
   * 从地址簿中删除设备
   * 批量删除指定地址簿中的设备，同时删除标签关联
   *
   * @param addressBookGuid 地址簿GUID
   * @param ids 要删除的设备ID列表（RustDesk ID）
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @returns 操作结果
   * @throws BadRequestException 当未提供设备ID时抛出
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
    // 如果提供了用户ID，验证写权限
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    if (!ids || ids.length === 0) {
      throw new BadRequestException('请提供要删除的设备ID');
    }

    // ids 是 RustDesk ID 数组，需要先查找对应的 uuid
    const peerRecords = await this.peerRepository.find({
      where: { id: In(ids) },
    });

    const deviceIds = peerRecords.map((p) => p.uuid);

    if (deviceIds.length > 0) {
      // 根据 deviceId 删除（会自动级联删除标签关联）
      await this.addressBookPeerRepository.delete({
        deviceId: In(deviceIds),
        addressBookGuid,
      });
    }

    return {};
  }
}
