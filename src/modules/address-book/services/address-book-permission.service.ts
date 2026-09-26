import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { AddressBook, AddressBookRule, ShareRule } from '../entities';
import { User } from '../../user/entities/user.entity';

/**
 * Address book permission check service
 * Responsible for checking user access permissions to address books
 *
 * This service was extracted to avoid circular dependencies:
 * - AddressBookService needs permission checks
 * - AddressBookRuleService also needs permission checks
 * - Keeping the permission check logic separate lets both services use it
 */
@Injectable()
export class AddressBookPermissionService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,

    @InjectRepository(AddressBookRule)
    private ruleRepository: Repository<AddressBookRule>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * Check whether the user has permission to access the address book
   * Verify the user's access permission to the address book, including ownership checks and rule permission checks
   *
   * @param addressBookGuid Address book GUID
   * @param userId User ID
   * @param requiredRule Required permission level (defaults to read-only)
   * @returns Address book object
   * @throws NotFoundException Thrown when the address book does not exist
   * @throws ForbiddenException Thrown when the user has no permission or insufficient permission
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
      throw new NotFoundException('Address book does not exist');
    }

    // The owner has full permission
    if (addressBook.owner === userId) {
      return addressBook;
    }

    const user = await this.userRepository.findOne({
      where: { guid: userId },
      select: ['guid', 'userGroupGuid'],
    });
    if (!user) {
      throw new ForbiddenException('No permission to access this address book');
    }

    const applicableTargets: FindOptionsWhere<AddressBookRule>[] = [
      {
        addressBookGuid,
        targetUserId: userId,
        targetGroupId: IsNull(),
      },
      {
        addressBookGuid,
        targetUserId: IsNull(),
        targetGroupId: IsNull(),
      },
    ];

    if (user.userGroupGuid) {
      applicableTargets.push({
        addressBookGuid,
        targetUserId: IsNull(),
        targetGroupId: user.userGroupGuid,
      });
    }

    const rules = await this.ruleRepository.find({ where: applicableTargets });
    const effectiveRule = rules.reduce(
      (strongest, rule) => Math.max(strongest, rule.rule),
      0,
    );

    if (effectiveRule === 0) {
      throw new ForbiddenException('No permission to access this address book');
    }

    // Check the permission level
    if (effectiveRule < Number(requiredRule)) {
      const requiredPermission =
        requiredRule === ShareRule.READ_WRITE ? 'Read-write' : 'Full control';
      throw new ForbiddenException(`${requiredPermission} permission required`);
    }

    return addressBook;
  }
}
