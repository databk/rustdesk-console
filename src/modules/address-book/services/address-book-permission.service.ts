import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AddressBook, AddressBookRule, ShareRule } from '../entities';

/**
 * 地址簿权限检查服务
 * 负责检查用户对地址簿的访问权限
 * 
 * 这个服务被提取出来是为了避免循环依赖：
 * - AddressBookService 需要权限检查
 * - AddressBookRuleService 也需要权限检查
 * - 将权限检查逻辑独立出来，两个服务都可以使用
 */
@Injectable()
export class AddressBookPermissionService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,

    @InjectRepository(AddressBookRule)
    private ruleRepository: Repository<AddressBookRule>,
  ) {}

  /**
   * 检查用户是否有权限访问地址簿
   * 验证用户对地址簿的访问权限，包括所有权检查和规则权限检查
   * 
   * @param addressBookGuid 地址簿 GUID
   * @param userId 用户 ID
   * @param requiredRule 需要的权限级别（默认为只读）
   * @returns 地址簿对象
   * @throws NotFoundException 当地址簿不存在时抛出
   * @throws ForbiddenException 当用户无权限或权限不足时抛出
   */
  async checkAddressBookAccess(
    addressBookGuid: string,
    userId: string,
    requiredRule: ShareRule = ShareRule.READ,
  ): Promise<AddressBook> {
    const addressBook = await this.addressBookRepository.findOne({
      where: { guid: addressBookGuid },
    });

    if (!addressBook) {
      throw new NotFoundException('地址簿不存在');
    }

    // 如果是所有者，拥有完全权限
    if (addressBook.owner === userId) {
      return addressBook;
    }

    // 检查规则权限（用户规则）
    const rule = await this.ruleRepository.findOne({
      where: { 
        addressBookGuid, 
        targetUserId: userId,
        targetGroupId: IsNull(),  // 确保是用户规则
      },
    });

    if (!rule) {
      throw new ForbiddenException('无权访问此地址簿');
    }

    // 检查权限级别
    if (rule.rule < requiredRule) {
      const requiredPermission = requiredRule === ShareRule.READ_WRITE ? '读写' : '完全控制';
      throw new ForbiddenException(`需要${requiredPermission}权限`);
    }

    return addressBook;
  }
}
