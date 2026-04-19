import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AddressBookRule, AddressBook, ShareRule } from '../entities';
import { User } from '../../user/entities/user.entity';
import {
  RuleQueryDto,
  CreateRuleDto,
  UpdateRuleDto,
  PaginationDto,
} from '../dto';
import { AddressBookPermissionService } from './address-book-permission.service';

/**
 * 地址簿规则服务
 * 管理地址簿的访问规则，包括增删改查操作和共享管理
 *
 * 功能：
 * - 获取规则列表（分页）
 * - 创建新规则
 * - 更新规则权限
 * - 批量删除规则
 * - 共享地址簿管理
 *
 * 权限级别：
 * - 1 (READ): 只读权限
 * - 2 (READ_WRITE): 读写权限
 * - 3 (FULL_CONTROL): 完全控制
 */
@Injectable()
export class AddressBookRuleService {
  constructor(
    @InjectRepository(AddressBookRule)
    private ruleRepository: Repository<AddressBookRule>,

    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    private readonly permissionService: AddressBookPermissionService,
  ) {}

  /**
   * 获取地址簿规则列表
   * 分页查询指定地址簿的所有规则
   *
   * @param query 查询参数（包含地址簿 GUID 和分页信息）
   * @param userId 当前用户 ID
   * @returns 规则列表（分页）
   * @throws ForbiddenException 用户无权限访问该地址簿
   */
  async getRules(query: RuleQueryDto, userId: string) {
    // 检查用户是否有权限访问该地址簿
    await this.permissionService.checkAddressBookAccess(query.ab, userId);

    const { ab, current = 1, pageSize = 30 } = query;

    // 查询总数
    const total = await this.ruleRepository.count({
      where: { addressBookGuid: ab },
    });

    // 查询规则列表
    const rules = await this.ruleRepository.find({
      where: { addressBookGuid: ab },
      relations: ['addressBook'],
      skip: (current - 1) * pageSize,
      take: pageSize,
      order: { createdAt: 'ASC' },
    });

    return {
      data: rules.map((rule) => this.toResponseFormat(rule)),
      total,
    };
  }

  /**
   * 创建新规则
   * 为指定地址簿添加新的访问规则
   *
   * @param dto 创建规则数据
   * @param userId 当前用户 ID
   * @returns 新创建的规则 GUID
   * @throws NotFoundException 地址簿不存在
   * @throws ForbiddenException 用户无权限修改该地址簿
   * @throws ConflictException 规则已存在
   */
  async createRule(dto: CreateRuleDto, userId: string) {
    // 检查地址簿是否存在且用户有权限修改
    await this.permissionService.checkAddressBookAccess(
      dto.guid,
      userId,
      ShareRule.FULL_CONTROL,
    );

    // 确定规则类型和目标
    const { user, group, rule = 1 } = dto;

    // 验证用户和组互斥
    if (user && group) {
      throw new ConflictException('用户和组不能同时指定');
    }

    // 如果没有指定用户或组，默认为 everyone
    let finalTargetUserId = user || '';
    const finalTargetGroupId = group || '';

    // 如果提供了用户名而不是用户GUID，尝试查找用户
    if (finalTargetUserId && !finalTargetUserId.includes('-')) {
      const userEntity = await this.userRepository.findOne({
        where: { username: finalTargetUserId },
      });
      if (userEntity) {
        finalTargetUserId = userEntity.guid;
      } else {
        throw new NotFoundException('用户不存在');
      }
    }

    // 检查是否已存在相同规则
    const whereClause: Record<string, unknown> = {
      addressBookGuid: dto.guid,
    };

    // 只添加非空值到 where 子句
    if (finalTargetUserId) {
      whereClause.targetUserId = finalTargetUserId;
    }
    if (finalTargetGroupId) {
      whereClause.targetGroupId = finalTargetGroupId;
    }

    const existingRule = await this.ruleRepository.findOne({
      where: whereClause as Partial<AddressBookRule>,
    });

    if (existingRule) {
      throw new ConflictException('该规则已存在');
    }

    // 创建新规则
    const newRule: Partial<AddressBookRule> = {
      guid: uuidv4(),
      addressBookGuid: dto.guid,
      targetUserId: finalTargetUserId,
      targetGroupId: finalTargetGroupId,
      rule,
    };

    await this.ruleRepository.save(newRule);

    return { guid: newRule.guid };
  }

  /**
   * 更新规则
   * 修改指定规则的权限级别
   *
   * @param dto 更新规则数据
   * @param userId 当前用户 ID
   * @returns 更新成功消息
   * @throws NotFoundException 规则不存在
   * @throws ForbiddenException 用户无权限修改该规则
   */
  async updateRule(dto: UpdateRuleDto, userId: string) {
    // 查找规则
    const rule = await this.ruleRepository.findOne({
      where: { guid: dto.guid },
      relations: ['addressBook'],
    });

    if (!rule) {
      throw new NotFoundException('规则不存在');
    }

    // 检查用户是否有权限修改该规则
    await this.permissionService.checkAddressBookAccess(
      rule.addressBookGuid,
      userId,
      ShareRule.FULL_CONTROL,
    );

    // 更新规则权限
    rule.rule = dto.rule;
    await this.ruleRepository.save(rule);

    return { message: '更新成功' };
  }

  /**
   * 批量删除规则
   * 删除一个或多个规则
   *
   * @param ruleGuids 要删除的规则 GUID 数组
   * @param userId 当前用户 ID
   * @returns 删除成功消息
   * @throws BadRequestException 参数无效
   * @throws ForbiddenException 用户无权限修改地址簿
   */
  async deleteRules(ruleGuids: string[], userId: string) {
    if (!ruleGuids || ruleGuids.length === 0) {
      throw new BadRequestException('至少需要一个规则 GUID');
    }

    // 获取所有规则的信息（用于权限检查和获取 addressBookGuid 字段）
    const rules = await this.ruleRepository.find({
      where: ruleGuids.map((g) => ({ guid: g })),
      relations: ['addressBook'],
    });

    if (rules.length === 0) {
      throw new NotFoundException('未找到任何规则');
    }

    // 检查每个规则所属的地址簿权限，确保用户对所有地址簿都有权限
    for (const rule of rules) {
      await this.permissionService.checkAddressBookAccess(
        rule.addressBookGuid,
        userId,
        ShareRule.FULL_CONTROL,
      );
    }

    // 由于 AddressBookRule 有多个主键，需要使用完整的主键对象删除
    for (const rule of rules) {
      await this.ruleRepository.delete({
        guid: rule.guid,
        addressBookGuid: rule.addressBookGuid,
      });
    }

    return { message: '删除成功' };
  }

  // ============ 共享地址簿管理（替代 AddressBookShareService） ============

  /**
   * 获取共享地址簿列表
   * 查询所有共享给当前用户的地址簿
   *
   * @param userId 用户 ID
   * @param query 分页查询参数
   * @returns 共享地址簿列表和总数
   */
  async getSharedAddressBooks(userId: string, query: PaginationDto) {
    const { current = 1, pageSize = 100, name } = query;
    const skip = (current - 1) * pageSize;

    const whereCondition: Record<string, unknown> = {
      targetUserId: userId,
      targetGroupId: IsNull(), // 只查询用户规则
    };

    const [rules, total] = await this.ruleRepository.findAndCount({
      where: whereCondition as Partial<AddressBookRule>,
      relations: ['addressBook'],
      skip,
      take: pageSize,
    });

    // 收集所有 owner (用户 GUID)
    const ownerGuids = [
      ...new Set(
        rules
          .map((r) => r.addressBook?.owner)
          .filter((guid): guid is string => !!guid),
      ),
    ];

    // 批量查询用户信息
    const users =
      ownerGuids.length > 0
        ? await this.userRepository.find({
            where: { guid: In(ownerGuids) },
            select: ['guid', 'username'],
          })
        : [];
    const userMap = new Map(users.map((u) => [u.guid, u.username]));

    // 组装返回数据
    let data = rules.map((r) => ({
      guid: r.addressBookGuid,
      name: r.addressBook?.name || '',
      owner:
        userMap.get(r.addressBook?.owner || '') || r.addressBook?.owner || '',
      note: r.addressBook?.note || '',
      rule: r.rule,
      info: r.addressBook?.info
        ? (JSON.parse(r.addressBook.info) as Record<string, unknown>)
        : {},
    }));

    // 如果提供了name参数，进行过滤
    if (name) {
      data = data.filter((item) => item.name.includes(name));
    }

    return { total, data };
  }

  /**
   * 添加共享地址簿
   * 创建一个新的共享地址簿记录
   *
   * @param name 地址簿名称
   * @param ownerUserId 所有者用户 ID
   * @param note 备注（可选）
   * @param password 密码（可选）
   * @returns 新创建的地址簿 GUID
   * @throws ConflictException 如果名称已存在
   */
  async addSharedAddressBook(
    name: string,
    ownerUserId: string,
    note?: string,
    password?: string,
  ): Promise<string> {
    // 检查名称是否已存在
    const existing = await this.addressBookRepository.findOne({
      where: { name, owner: ownerUserId, isPersonal: false },
    });

    if (existing) {
      throw new ConflictException('地址簿名称已存在');
    }

    // 创建地址簿
    const addressBook = this.addressBookRepository.create({
      guid: uuidv4(),
      name,
      owner: ownerUserId,
      isPersonal: false,
      note,
      info: password ? JSON.stringify({ password }) : undefined,
    });

    await this.addressBookRepository.save(addressBook);

    // 自动给创建者添加full权限的规则
    const rule = this.ruleRepository.create({
      guid: uuidv4(),
      addressBookGuid: addressBook.guid,
      targetUserId: ownerUserId,
      rule: 3, // full control
    });
    await this.ruleRepository.save(rule);

    return addressBook.guid;
  }

  /**
   * 更新共享地址簿
   * 更新现有共享地址簿的信息
   *
   * 权限要求：
   * - 修改名称、备注、密码：需要 READ_WRITE 权限
   * - 更改所有者：需要 FULL_CONTROL 权限
   *
   * @param guid 地址簿 GUID
   * @param name 新名称（可选）
   * @param note 新备注（可选）
   * @param owner 新所有者（可选）
   * @param password 新密码（可选）
   * @param userId 当前用户 ID
   * @throws NotFoundException 地址簿或用户不存在
   * @throws ForbiddenException 无权限修改
   * @throws ConflictException 名称已存在
   */
  async updateSharedAddressBook(
    guid: string,
    name?: string,
    note?: string,
    owner?: string,
    password?: string,
    userId?: string,
  ): Promise<void> {
    const addressBook = await this.addressBookRepository.findOne({
      where: { guid },
    });

    if (!addressBook) {
      throw new NotFoundException('地址簿不存在');
    }

    // 判断是否需要更改所有者
    const isChangingOwner = owner !== undefined && owner !== addressBook.owner;

    // 确定所需的权限级别
    const requiredRule = isChangingOwner
      ? ShareRule.FULL_CONTROL
      : ShareRule.READ_WRITE;

    // 验证用户权限
    if (userId) {
      await this.permissionService.checkAddressBookAccess(
        guid,
        userId,
        requiredRule,
      );
    }

    // 如果要更改所有者，需要验证新所有者存在
    if (isChangingOwner) {
      const newOwner = await this.userRepository.findOne({
        where: { guid: owner },
      });
      if (!newOwner) {
        throw new NotFoundException('新所有者用户不存在');
      }

      // 检查新所有者是否已经有该地址簿的访问权限
      const existingRule = await this.ruleRepository.findOne({
        where: {
          addressBookGuid: guid,
          targetUserId: owner,
          targetGroupId: IsNull(),
        },
      });

      if (!existingRule) {
        // 如果新所有者没有权限，需要先赋予权限
        const newRule = this.ruleRepository.create({
          guid: uuidv4(),
          addressBookGuid: guid,
          targetUserId: owner,
          rule: ShareRule.FULL_CONTROL,
        });
        await this.ruleRepository.save(newRule);
      }
    }

    // 检查名称是否已被其他地址簿使用
    if (name && name !== addressBook.name) {
      const existing = await this.addressBookRepository.findOne({
        where: { name, owner: owner || addressBook.owner, isPersonal: false },
      });
      if (existing && existing.guid !== guid) {
        throw new ConflictException('地址簿名称已存在');
      }
    }

    // 更新字段
    if (name !== undefined) Object.assign(addressBook, { name });
    if (note !== undefined) Object.assign(addressBook, { note });
    if (owner !== undefined) Object.assign(addressBook, { owner });
    if (password !== undefined) {
      Object.assign(addressBook, {
        info: password ? JSON.stringify({ password }) : undefined,
      });
    }

    await this.addressBookRepository.save(addressBook);
  }

  /**
   * 删除共享地址簿
   * 删除一个或多个共享地址簿
   *
   * @param guids 地址簿 GUID 数组
   * @param userId 用户 ID（需要所有者权限）
   * @throws ForbiddenException 无权限删除
   */
  async deleteSharedAddressBooks(
    guids: string[],
    userId: string,
  ): Promise<void> {
    for (const guid of guids) {
      const addressBook = await this.addressBookRepository.findOne({
        where: { guid },
      });

      if (!addressBook) {
        continue; // 跳过不存在的地址簿
      }

      // 检查所有权
      if (addressBook.owner !== userId) {
        throw new ForbiddenException(`无权删除地址簿 '${addressBook.name}'`);
      }

      // 删除地址簿及其关联的规则记录
      await this.addressBookRepository.delete(guid);
      await this.ruleRepository.delete({ addressBookGuid: guid });
    }
  }

  /**
   * 共享地址簿给其他用户
   * 将地址簿共享给指定用户，并设置权限级别
   *
   * @param addressBookGuid 地址簿 GUID
   * @param targetUserId 目标用户 ID
   * @param rule 共享权限级别
   * @param ownerUserId 地址簿所有者用户 ID
   * @returns 操作结果
   * @throws ForbiddenException 当用户没有完全控制权限时抛出
   */
  async shareAddressBook(
    addressBookGuid: string,
    targetUserId: string,
    rule: ShareRule,
    ownerUserId: string,
  ) {
    // 验证所有权
    await this.permissionService.checkAddressBookAccess(
      addressBookGuid,
      ownerUserId,
      ShareRule.FULL_CONTROL,
    );

    // 检查是否已共享
    let sharedRule = await this.ruleRepository.findOne({
      where: {
        addressBookGuid,
        targetUserId,
        targetGroupId: IsNull(),
      },
    });

    if (sharedRule) {
      // 已共享，更新权限级别
      sharedRule.rule = rule;
    } else {
      // 未共享，创建新的规则记录
      sharedRule = this.ruleRepository.create({
        guid: uuidv4(),
        addressBookGuid,
        targetUserId,
        rule,
      });
    }

    await this.ruleRepository.save(sharedRule);
    return { message: '共享成功' };
  }

  /**
   * 取消地址簿共享
   * 取消地址簿对指定用户的共享
   *
   * @param addressBookGuid 地址簿 GUID
   * @param targetUserId 目标用户 ID
   * @param ownerUserId 地址簿所有者用户 ID
   * @returns 操作结果
   * @throws ForbiddenException 当用户没有完全控制权限时抛出
   */
  async unshareAddressBook(
    addressBookGuid: string,
    targetUserId: string,
    ownerUserId: string,
  ) {
    // 验证所有权
    await this.permissionService.checkAddressBookAccess(
      addressBookGuid,
      ownerUserId,
      ShareRule.FULL_CONTROL,
    );

    // 删除规则记录
    await this.ruleRepository.delete({
      addressBookGuid,
      targetUserId,
      targetGroupId: IsNull(),
    });

    return { message: '取消共享成功' };
  }

  // ============ 私有辅助方法 ============

  /**
   * 将规则转换为响应格式
   * @param rule 规则实体
   * @returns 响应格式的对象
   */
  private toResponseFormat(rule: AddressBookRule): Record<string, unknown> {
    return {
      guid: rule.guid,
      addressBook: {
        guid: rule.addressBookGuid,
        name: rule.addressBook?.name,
      },
      user: rule.targetUserId,
      group: rule.targetGroupId,
      rule: rule.rule,
      ruleType: rule.ruleType,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }
}
