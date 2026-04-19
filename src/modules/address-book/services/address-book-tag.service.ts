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
  AddressBookTag,
  AddressBookPeerTag,
  ShareRule,
} from '../entities';
import { AddTagDto, UpdateTagDto, RenameTagDto } from '../dto';

@Injectable()
/**
 * AddressBookTagService
 * 负责地址簿中标签管理的子服务
 *
 * 与主服务关系：
 * 被AddressBookService委托处理标签相关操作
 *
 * 调用上下文：
 * 包括标签的添加、更新、删除和查询
 */
export class AddressBookTagService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,
    @InjectRepository(AddressBookTag)
    private addressBookTagRepository: Repository<AddressBookTag>,
    @InjectRepository(AddressBookPeerTag)
    private addressBookPeerTagRepository: Repository<AddressBookPeerTag>,
  ) {}

  /**
   * 获取地址簿标签列表
   * 查询指定地址簿中的所有标签
   *
   * @param addressBookGuid 地址簿GUID
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @returns 标签列表，包含标签名称和颜色
   */
  async getTags(
    addressBookGuid: string,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    // 如果提供了用户ID，验证访问权限
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ);
    }

    const tags = await this.addressBookTagRepository.find({
      where: { addressBookGuid },
    });

    return tags.map((t) => ({
      name: t.name,
      color: t.color,
    }));
  }

  /**
   * 获取或创建标签
   * 查找指定名称的标签，如果不存在则创建
   * 主要用于设备添加/更新时的标签关联
   *
   * @param addressBookGuid 地址簿GUID
   * @param tagName 标签名称
   * @returns 标签GUID
   */
  async getOrCreateTag(
    addressBookGuid: string,
    tagName: string,
  ): Promise<string> {
    let tag = await this.addressBookTagRepository.findOne({
      where: { name: tagName, addressBookGuid },
    });

    if (!tag) {
      // 标签不存在，创建新标签
      tag = this.addressBookTagRepository.create({
        guid: uuidv4(),
        addressBookGuid,
        name: tagName,
        color: 0,
      });
      await this.addressBookTagRepository.save(tag);
    }

    return tag.guid;
  }

  /**
   * 添加标签
   * 向指定地址簿添加新标签
   *
   * @param addressBookGuid 地址簿GUID
   * @param dto 标签信息DTO，包含标签名称和颜色
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @returns 操作结果
   * @throws NotFoundException 当地址簿不存在时抛出
   * @throws BadRequestException 当标签已存在时抛出
   */
  async addTag(
    addressBookGuid: string,
    dto: AddTagDto,
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

    const addressBook = await this.addressBookRepository.findOne({
      where: { guid: addressBookGuid },
    });

    if (!addressBook) {
      throw new NotFoundException('地址簿不存在');
    }

    // 检查标签是否已存在
    const existingTag = await this.addressBookTagRepository.findOne({
      where: { name: dto.name, addressBookGuid },
    });

    if (existingTag) {
      throw new BadRequestException('标签已存在');
    }

    // 创建新标签
    const tag = this.addressBookTagRepository.create({
      guid: uuidv4(),
      addressBookGuid,
      name: dto.name,
      color: dto.color || 0,
    });

    await this.addressBookTagRepository.save(tag);
    return {};
  }

  /**
   * 重命名标签
   * 修改标签的名称，同时检查新名称是否冲突
   *
   * @param addressBookGuid 地址簿GUID
   * @param dto 重命名信息DTO，包含旧标签名和新标签名
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @returns 操作结果
   * @throws NotFoundException 当旧标签不存在时抛出
   * @throws BadRequestException 当新标签名已存在时抛出
   */
  async renameTag(
    addressBookGuid: string,
    dto: RenameTagDto,
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

    // 根据旧标签名查找标签
    const tag = await this.addressBookTagRepository.findOne({
      where: { name: dto.old, addressBookGuid },
    });

    if (!tag) {
      throw new NotFoundException('标签不存在');
    }

    // 检查新标签名是否已存在
    const existingTag = await this.addressBookTagRepository.findOne({
      where: { name: dto.new, addressBookGuid },
    });

    if (existingTag) {
      throw new BadRequestException('新标签名已存在');
    }

    // 更新标签名称
    await this.addressBookTagRepository.update(
      { guid: tag.guid },
      { name: dto.new },
    );
    return {};
  }

  /**
   * 更新标签颜色
   * 修改标签的颜色属性，用于UI显示
   *
   * @param addressBookGuid 地址簿GUID
   * @param dto 标签更新信息DTO，包含标签名和新颜色
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @returns 操作结果
   * @throws NotFoundException 当标签不存在时抛出
   */
  async updateTag(
    addressBookGuid: string,
    dto: UpdateTagDto,
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

    // 根据标签名查找标签
    const tag = await this.addressBookTagRepository.findOne({
      where: { name: dto.name, addressBookGuid },
    });

    if (!tag) {
      throw new NotFoundException('标签不存在');
    }

    // 更新标签颜色
    await this.addressBookTagRepository.update(
      { guid: tag.guid },
      { color: dto.color },
    );
    return {};
  }

  /**
   * 删除标签
   * 批量删除指定地址簿中的标签，同时删除所有设备与这些标签的关联
   *
   * @param addressBookGuid 地址簿GUID
   * @param names 要删除的标签名称列表
   * @param userId 用户ID（可选，用于权限验证）
   * @param checkAccess 权限检查函数（可选）
   * @returns 操作结果
   * @throws BadRequestException 当未提供标签名称时抛出
   */
  async deleteTags(
    addressBookGuid: string,
    names: string[],
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

    if (!names || names.length === 0) {
      throw new BadRequestException('请提供要删除的标签名');
    }

    // 获取要删除的标签GUID
    const tags = await this.addressBookTagRepository.find({
      where: { name: In(names), addressBookGuid },
    });

    const tagGuids = tags.map((t) => t.guid);

    // 先删除标签与设备的关联关系
    if (tagGuids.length > 0) {
      await this.addressBookPeerTagRepository.delete({
        tagGuid: In(tagGuids),
      });
    }

    // 删除标签
    await this.addressBookTagRepository.delete({
      name: In(names),
      addressBookGuid,
    });

    return {};
  }
}
