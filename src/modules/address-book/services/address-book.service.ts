import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AddressBook, ShareRule } from '../entities';
import { User } from '../../user/entities/user.entity';
import {
  PaginationDto,
  PeersQueryDto,
  AddPeerDto,
  UpdatePeerDto,
  AddTagDto,
  UpdateTagDto,
  RenameTagDto,
} from '../dto';
import { AddressBookPeerService } from './address-book-peer.service';
import { AddressBookTagService } from './address-book-tag.service';
import { AddressBookLegacyService } from './address-book-legacy.service';
import { AddressBookRuleService } from './address-book-rule.service';
import { AddressBookPermissionService } from './address-book-permission.service';

/**
 * 地址簿服务
 * 地址簿模块的核心服务，负责协调各个子服务的功能
 *
 * 功能：
 * - 地址簿基础管理（创建、获取、权限检查）
 * - 设备管理（委托给 PeerService）
 * - 标签管理（委托给 TagService）
 * - 共享管理（委托给 RuleService）
 * - 旧版 API 兼容（委托给 LegacyService）
 *
 * 架构说明：
 * 采用服务委托模式，将具体功能委托给专门的子服务处理
 * 主服务负责权限检查、协调和路由
 */
@Injectable()
export class AddressBookService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly peerService: AddressBookPeerService,
    private readonly tagService: AddressBookTagService,
    private readonly ruleService: AddressBookRuleService,
    private readonly legacyService: AddressBookLegacyService,
    private readonly permissionService: AddressBookPermissionService,
  ) {}

  // ============ 地址簿基础管理 ============

  /**
   * 获取地址簿设置
   * 获取地址簿的全局配置参数
   *
   * @returns 地址簿设置对象
   */
  getSettings() {
    return { max_peer_one_ab: 0 };
  }

  /**
   * 获取个人地址簿 GUID
   * 获取或创建用户的个人地址簿
   *
   * @param userId 用户 ID
   * @returns 包含地址簿 GUID 的对象
   */
  async getPersonalAddressBook(userId: string) {
    let addressBook = await this.addressBookRepository.findOne({
      where: { owner: userId, isPersonal: true },
    });

    if (!addressBook) {
      // 如果个人地址簿不存在，自动创建
      addressBook = this.addressBookRepository.create({
        guid: uuidv4(),
        owner: userId,
        name: 'Personal',
        isPersonal: true,
      });
      await this.addressBookRepository.save(addressBook);
    }

    return { guid: addressBook.guid };
  }

  // ============ 设备管理（委托给 PeerService） ============

  /**
   * 获取地址簿中的设备列表
   * 委托给 PeerService 处理，自动进行权限验证
   *
   * @param query 查询参数，包含分页和过滤条件
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 设备列表和总数
   */
  async getPeers(query: PeersQueryDto, userId?: string) {
    return this.peerService.getPeers(
      query,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * 添加设备到地址簿
   * 委托给 PeerService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param dto 设备信息 DTO
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 操作结果
   */
  async addPeer(addressBookGuid: string, dto: AddPeerDto, userId?: string) {
    return this.peerService.addPeer(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
      (abGuid: string, tagName: string) =>
        this.tagService.getOrCreateTag(abGuid, tagName),
    );
  }

  /**
   * 更新地址簿中的设备信息
   * 委托给 PeerService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param dto 设备更新信息 DTO
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 操作结果
   */
  async updatePeer(
    addressBookGuid: string,
    dto: UpdatePeerDto,
    userId?: string,
  ) {
    return this.peerService.updatePeer(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
      (abGuid: string, tagName: string) =>
        this.tagService.getOrCreateTag(abGuid, tagName),
    );
  }

  /**
   * 从地址簿中删除设备
   * 委托给 PeerService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param ids 要删除的设备 ID 列表
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 操作结果
   */
  async deletePeers(addressBookGuid: string, ids: string[], userId?: string) {
    return this.peerService.deletePeers(
      addressBookGuid,
      ids,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  // ============ 标签管理（委托给 TagService） ============

  /**
   * 获取地址簿标签列表
   * 委托给 TagService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 标签列表
   */
  async getTags(addressBookGuid: string, userId?: string) {
    return this.tagService.getTags(
      addressBookGuid,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * 添加标签到地址簿
   * 委托给 TagService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param dto 标签信息 DTO
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 操作结果
   */
  async addTag(addressBookGuid: string, dto: AddTagDto, userId?: string) {
    return this.tagService.addTag(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * 重命名标签
   * 委托给 TagService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param dto 重命名信息 DTO
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 操作结果
   */
  async renameTag(addressBookGuid: string, dto: RenameTagDto, userId?: string) {
    return this.tagService.renameTag(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * 更新标签颜色
   * 委托给 TagService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param dto 标签更新信息 DTO
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 操作结果
   */
  async updateTag(addressBookGuid: string, dto: UpdateTagDto, userId?: string) {
    return this.tagService.updateTag(
      addressBookGuid,
      dto,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  /**
   * 删除标签
   * 委托给 TagService 处理，自动进行权限验证
   *
   * @param addressBookGuid 地址簿 GUID
   * @param names 要删除的标签名称列表
   * @param userId 用户 ID（可选，用于权限验证）
   * @returns 操作结果
   */
  async deleteTags(addressBookGuid: string, names: string[], userId?: string) {
    return this.tagService.deleteTags(
      addressBookGuid,
      names,
      userId,
      (abGuid: string, uId: string, rule: ShareRule) =>
        this.permissionService.checkAddressBookAccess(abGuid, uId, rule),
    );
  }

  // ============ 共享管理（委托给 RuleService） ============

  /**
   * 获取共享给用户的地址簿列表
   * 委托给 RuleService 处理
   *
   * @param userId 用户 ID
   * @param query 分页查询参数
   * @returns 共享地址簿列表
   */
  async getSharedAddressBooks(userId: string, query: PaginationDto) {
    return this.ruleService.getSharedAddressBooks(userId, query);
  }

  /**
   * 添加共享地址簿
   * 委托给 RuleService 处理
   *
   * @param name 地址簿名称
   * @param userId 用户 ID
   * @param note 备注
   * @param password 密码
   * @returns 新创建的地址簿 GUID
   */
  async addSharedAddressBook(
    name: string,
    userId?: string,
    note?: string,
    password?: string,
  ) {
    return this.ruleService.addSharedAddressBook(
      name,
      userId || '',
      note,
      password,
    );
  }

  /**
   * 更新共享地址簿
   * 委托给 RuleService 处理
   *
   * @param guid 地址簿 GUID
   * @param name 新名称
   * @param note 新备注
   * @param owner 新所有者
   * @param password 新密码
   * @param userId 当前用户 ID
   */
  async updateSharedAddressBook(
    guid: string,
    name?: string,
    note?: string,
    owner?: string,
    password?: string,
    userId?: string,
  ) {
    return this.ruleService.updateSharedAddressBook(
      guid,
      name,
      note,
      owner,
      password,
      userId,
    );
  }

  /**
   * 删除共享地址簿
   * 委托给 RuleService 处理
   *
   * @param guids 地址簿 GUID 数组
   * @param userId 用户 ID
   */
  async deleteSharedAddressBooks(guids: string[], userId: string) {
    return this.ruleService.deleteSharedAddressBooks(guids, userId);
  }

  // ============ 旧版（Legacy）API（委托给 LegacyService） ============

  /**
   * 获取旧版地址簿数据
   * 委托给 LegacyService 处理，用于兼容旧版本客户端
   *
   * @param userId 用户 ID
   * @returns 旧版地址簿数据
   */
  async getLegacyAddressBook(userId: string) {
    return this.legacyService.getLegacyAddressBook(userId);
  }

  /**
   * 更新旧版地址簿数据
   * 委托给 LegacyService 处理，用于兼容旧版本客户端
   *
   * @param userId 用户 ID
   * @param data 地址簿数据字符串
   * @returns 操作结果
   */
  async updateLegacyAddressBook(userId: string, data: string) {
    return this.legacyService.updateLegacyAddressBook(userId, data);
  }
}
