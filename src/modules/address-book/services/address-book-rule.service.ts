import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { isUUID } from 'class-validator';
import { AddressBookRule, AddressBook, ShareRule } from '../entities';
import { User } from '../../user/entities/user.entity';
import {
  RuleQueryDto,
  CreateRuleDto,
  UpdateRuleDto,
  PaginationDto,
} from '../dto';
import { AddressBookPermissionService } from './address-book-permission.service';
import { UserGroupService } from '../../user-group/user-group.service';
import { UserGroup } from '../../user-group/entities/user-group.entity';

interface SharedAddressBookRow {
  guid: string;
  name: string | null;
  owner: string;
  note: string | null;
  info?: string | null;
  rule: string | number;
}

const EXTERNAL_GRANT_EXISTS = `EXISTS (
  SELECT 1
  FROM address_book_rules externalRule
  WHERE externalRule.addressBookGuid = addressBook.guid
    AND (
      externalRule.targetGroupId IS NOT NULL
      OR externalRule.targetUserId IS NULL
      OR externalRule.targetUserId <> addressBook.owner
    )
)`;

/**
 * Address book rule service
 * Manages address book access rules, including CRUD operations and share management
 *
 * Features:
 * - Get the rule list (paginated)
 * - Create new rules
 * - Update rule permissions
 * - Batch delete rules
 * - Shared address book management
 *
 * Permission levels:
 * - 1 (READ): read-only permission
 * - 2 (READ_WRITE): read-write permission
 * - 3 (FULL_CONTROL): full control
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

    @InjectRepository(UserGroup)
    private userGroupRepository: Repository<UserGroup>,

    private readonly permissionService: AddressBookPermissionService,
    private readonly userGroupService: UserGroupService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get the address book rule list
   * Query all rules of the specified address book (paginated)
   *
   * @param query Query parameters (including the address book GUID and pagination info)
   * @param userId Current user ID
   * @returns Rule list (paginated)
   * @throws ForbiddenException User has no permission to access this address book
   */
  async getRules(query: RuleQueryDto, userId: string) {
    // Check whether the user has permission to access this address book
    await this.permissionService.checkAddressBookAccess(query.ab, userId);

    const { ab, current = 1, pageSize = 30 } = query;

    // Query the total count
    const total = await this.ruleRepository.count({
      where: { addressBookGuid: ab },
    });

    // Query the rule list
    const rules = await this.ruleRepository.find({
      where: { addressBookGuid: ab },
      relations: ['addressBook'],
      skip: (current - 1) * pageSize,
      take: pageSize,
      order: { createdAt: 'ASC' },
    });

    const userIds = [
      ...new Set(
        rules
          .map((rule) => rule.targetUserId)
          .filter((guid): guid is string => Boolean(guid)),
      ),
    ];
    const groupIds = [
      ...new Set(
        rules
          .map((rule) => rule.targetGroupId)
          .filter((guid): guid is string => Boolean(guid)),
      ),
    ];
    const usersPromise: Promise<User[]> = userIds.length
      ? this.userRepository.find({
          where: { guid: In(userIds) },
          select: ['guid', 'username', 'displayName'],
        })
      : Promise.resolve([]);
    const groupsPromise: Promise<UserGroup[]> = groupIds.length
      ? this.userGroupRepository.find({
          where: { guid: In(groupIds) },
          select: ['guid', 'name'],
        })
      : Promise.resolve([]);
    const [users, groups] = await Promise.all([usersPromise, groupsPromise]);
    const userTargets = new Map<string, { name: string; display_name: string }>(
      users.map((user) => [
        user.guid,
        {
          name: user.username,
          display_name: user.displayName || user.username,
        },
      ]),
    );
    const groupTargets = new Map<string, { name: string }>(
      groups.map((group) => [group.guid, { name: group.name }] as const),
    );

    return {
      data: rules.map((rule) => ({
        ...this.toResponseFormat(rule),
        target:
          (rule.targetUserId && userTargets.get(rule.targetUserId)) ||
          (rule.targetGroupId && groupTargets.get(rule.targetGroupId)) ||
          undefined,
      })),
      total,
    };
  }

  /**
   * Create a new rule
   * Adds a new access rule to the specified address book
   *
   * @param dto Rule creation data
   * @param userId Current user ID
   * @returns GUID of the newly created rule
   * @throws NotFoundException Address book does not exist
   * @throws ForbiddenException User has no permission to modify this address book
   * @throws ConflictException Rule already exists
   */
  async createRule(dto: CreateRuleDto, userId: string) {
    // Check that the address book exists and the user has permission to modify it
    await this.permissionService.checkAddressBookAccess(
      dto.guid,
      userId,
      ShareRule.FULL_CONTROL,
    );

    // Determine the rule type and target
    const { user, group, rule = 1 } = dto;

    // Verify that user and group are mutually exclusive
    if (user && group) {
      throw new ConflictException('User and group cannot both be specified');
    }

    // If neither user nor group is specified, default to everyone
    let finalTargetUserId: string | null = null;
    let finalTargetGroupId: string | null = null;

    // If a username was provided instead of a user GUID, try to look up the user
    if (user) {
      const userEntity = await this.userRepository.findOne({
        where: isUUID(user, '4') ? { guid: user } : { username: user },
      });
      if (userEntity) {
        finalTargetUserId = userEntity.guid;
      } else {
        throw new NotFoundException('User does not exist');
      }
    }

    if (group) {
      finalTargetGroupId = (await this.userGroupService.requireGroup(group))
        .guid;
    }

    // Check whether an identical rule already exists
    const whereClause: FindOptionsWhere<AddressBookRule> = {
      addressBookGuid: dto.guid,
      targetUserId: finalTargetUserId || IsNull(),
      targetGroupId: finalTargetGroupId || IsNull(),
    };

    const existingRule = await this.ruleRepository.findOne({
      where: whereClause,
    });

    if (existingRule) {
      throw new ConflictException('This rule already exists');
    }

    // Create a new rule
    const newRule = this.ruleRepository.create({
      guid: uuidv4(),
      addressBookGuid: dto.guid,
      targetUserId: finalTargetUserId,
      targetGroupId: finalTargetGroupId,
      rule,
    });

    await this.ruleRepository.save(newRule);

    return { guid: newRule.guid };
  }

  /**
   * Update a rule
   * Modify the permission level of the specified rule
   *
   * @param dto Rule update data
   * @param userId Current user ID
   * @returns Update success message
   * @throws NotFoundException Rule does not exist
   * @throws ForbiddenException User has no permission to modify this rule
   */
  async updateRule(dto: UpdateRuleDto, userId: string) {
    // Look up the rule
    const rule = await this.ruleRepository.findOne({
      where: { guid: dto.guid },
      relations: ['addressBook'],
    });

    if (!rule) {
      throw new NotFoundException('Rule does not exist');
    }

    // Check whether the user has permission to modify this rule
    await this.permissionService.checkAddressBookAccess(
      rule.addressBookGuid,
      userId,
      ShareRule.FULL_CONTROL,
    );

    // Update the rule permission
    rule.rule = dto.rule;
    await this.ruleRepository.save(rule);

    return { message: 'Updated successfully' };
  }

  /**
   * Batch delete rules
   * Delete one or more rules
   *
   * @param ruleGuids Array of rule GUIDs to delete
   * @param userId Current user ID
   * @returns Deletion success message
   * @throws BadRequestException Invalid parameters
   * @throws ForbiddenException User has no permission to modify the address book
   */
  async deleteRules(ruleGuids: string[], userId: string) {
    if (!ruleGuids || ruleGuids.length === 0) {
      throw new BadRequestException('At least one rule GUID is required');
    }
    const uniqueGuids = [...new Set(ruleGuids)];
    const invalidGuid = uniqueGuids.find((guid) => !isUUID(guid, '4'));
    if (invalidGuid) {
      throw new BadRequestException(`Invalid rule GUID format: ${invalidGuid}`);
    }

    await this.dataSource.transaction(async (manager) => {
      const ruleRepository = manager.getRepository(AddressBookRule);
      const rules = await ruleRepository.find({
        where: uniqueGuids.map((guid) => ({ guid })),
        relations: ['addressBook'],
      });
      const rulesByGuid = new Map<string, AddressBookRule[]>();
      for (const rule of rules) {
        const matches = rulesByGuid.get(rule.guid) || [];
        matches.push(rule);
        rulesByGuid.set(rule.guid, matches);
      }
      if (uniqueGuids.some((guid) => !rulesByGuid.has(guid))) {
        throw new NotFoundException('No rules found');
      }

      const orderedRules = uniqueGuids.flatMap(
        (guid) => rulesByGuid.get(guid) || [],
      );
      for (const rule of orderedRules) {
        await this.permissionService.checkAddressBookAccess(
          rule.addressBookGuid,
          userId,
          ShareRule.FULL_CONTROL,
        );
      }

      // AddressBookRule has a compound primary key; delete each complete key.
      for (const rule of orderedRules) {
        const result = await ruleRepository.delete({
          guid: rule.guid,
          addressBookGuid: rule.addressBookGuid,
        });
        if (result.affected !== 1) {
          throw new NotFoundException('No rules found');
        }
      }
    });

    return { message: 'Deleted successfully' };
  }

  // ============ Shared address book management (replaces AddressBookShareService) ============

  /**
   * Get the shared address book list
   * Query all address books shared with the current user
   *
   * @param userId User ID
   * @param query Pagination query parameters
   * @returns Shared address book list and total count
   */
  async getSharedAddressBooks(userId: string, query: PaginationDto) {
    return this.getAccessibleAddressBooks(userId, query, false);
  }

  async getWebSharedAddressBooks(userId: string, query: PaginationDto) {
    return this.getAccessibleAddressBooks(userId, query, true);
  }

  async getWebSharedAddressBook(guid: string, userId: string) {
    const result = await this.getAccessibleAddressBooks(
      userId,
      { current: 1, pageSize: 1 },
      true,
      guid,
    );
    const addressBook = result.data[0];
    if (!addressBook) {
      throw new NotFoundException('Shared address book does not exist');
    }
    return addressBook;
  }

  async getShareCandidates(guid: string, userId: string) {
    await this.permissionService.checkAddressBookAccess(
      guid,
      userId,
      ShareRule.FULL_CONTROL,
    );

    const [users, groups] = await Promise.all([
      this.userRepository.find({
        select: ['guid', 'username', 'displayName'],
        order: { username: 'ASC' },
      }),
      this.userGroupRepository.find({
        select: ['guid', 'name'],
        order: { name: 'ASC' },
      }),
    ]);

    return {
      users: users.map((user) => ({
        guid: user.guid,
        name: user.username,
        display_name: user.displayName || user.username,
      })),
      groups: groups.map((group) => ({
        guid: group.guid,
        name: group.name,
      })),
    };
  }

  async getCustomAddressBooks(userId: string, query: PaginationDto) {
    const { current = 1, pageSize = 100, name } = query;
    const skip = (current - 1) * pageSize;

    const queryBuilder = this.addressBookRepository
      .createQueryBuilder('addressBook')
      .where('addressBook.owner = :userId', { userId })
      .andWhere('addressBook.isPersonal = :isPersonal', {
        isPersonal: false,
      })
      .andWhere('addressBook.isShared = :isShared', { isShared: false })
      .andWhere(`NOT (${EXTERNAL_GRANT_EXISTS})`);

    const trimmedName = name?.trim();
    if (trimmedName) {
      queryBuilder.andWhere('addressBook.name LIKE :name', {
        name: `%${trimmedName}%`,
      });
    }

    const total = await queryBuilder.clone().getCount();
    const addressBooks = await queryBuilder
      .orderBy('addressBook.name', 'ASC')
      .addOrderBy('addressBook.guid', 'ASC')
      .skip(skip)
      .take(pageSize)
      .getMany();

    return {
      total,
      data: addressBooks.map((addressBook) => ({
        guid: addressBook.guid,
        name: addressBook.name || '',
        note: addressBook.note || '',
      })),
    };
  }

  async addCustomAddressBook(
    name: string,
    ownerUserId: string,
    note?: string,
    password?: string,
  ): Promise<string> {
    return this.createAddressBookProfile(
      name,
      ownerUserId,
      false,
      note,
      password,
    );
  }

  async updateCustomAddressBook(
    guid: string,
    userId: string,
    name?: string,
    note?: string,
  ): Promise<void> {
    if (name === undefined && note === undefined) {
      throw new BadRequestException('At least one field must be updated');
    }

    const addressBook = await this.findPrivateCustomAddressBook(guid, userId);
    if (!addressBook) {
      throw new NotFoundException('Private custom address book does not exist');
    }

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new BadRequestException('Address book name cannot be empty');
      }
      const existing = await this.addressBookRepository.findOne({
        where: {
          name: trimmedName,
          owner: userId,
          isPersonal: false,
        },
      });
      if (existing && existing.guid !== guid) {
        throw new ConflictException('Address book name already exists');
      }
      addressBook.name = trimmedName;
    }
    if (note !== undefined) {
      addressBook.note = note;
    }

    await this.addressBookRepository.save(addressBook);
  }

  async deleteCustomAddressBooks(
    guids: string[],
    userId: string,
  ): Promise<void> {
    const uniqueGuids = [...new Set(guids)];
    const addressBooks = await this.addressBookRepository
      .createQueryBuilder('addressBook')
      .where('addressBook.guid IN (:...guids)', { guids: uniqueGuids })
      .andWhere('addressBook.owner = :userId', { userId })
      .andWhere('addressBook.isPersonal = :isPersonal', {
        isPersonal: false,
      })
      .andWhere('addressBook.isShared = :isShared', { isShared: false })
      .andWhere(`NOT (${EXTERNAL_GRANT_EXISTS})`)
      .getMany();

    if (addressBooks.length !== uniqueGuids.length) {
      throw new NotFoundException(
        'One or more private custom address books do not exist',
      );
    }

    await this.addressBookRepository.delete({ guid: In(uniqueGuids) });
  }

  private async getAccessibleAddressBooks(
    userId: string,
    query: PaginationDto,
    sharedOnly: boolean,
    guid?: string,
  ) {
    const { current = 1, pageSize = 100, name } = query;
    const skip = (current - 1) * pageSize;

    const user = await this.userRepository.findOne({
      where: { guid: userId },
      select: ['guid', 'userGroupGuid'],
    });
    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    const subjectConditions = [
      '(rule.targetUserId = :userId AND rule.targetGroupId IS NULL)',
      '(rule.targetUserId IS NULL AND rule.targetGroupId IS NULL)',
    ];
    const parameters: Record<string, string> = { userId };
    if (user.userGroupGuid) {
      subjectConditions.push(
        '(rule.targetUserId IS NULL AND rule.targetGroupId = :userGroupGuid)',
      );
      parameters.userGroupGuid = user.userGroupGuid;
    }

    const queryBuilder = this.addressBookRepository
      .createQueryBuilder('addressBook')
      .leftJoin(
        AddressBookRule,
        'rule',
        `rule.addressBookGuid = addressBook.guid AND (${subjectConditions.join(
          ' OR ',
        )})`,
        parameters,
      )
      .where('addressBook.isPersonal = :isPersonal', { isPersonal: false })
      .andWhere('(addressBook.owner = :userId OR rule.guid IS NOT NULL)', {
        userId,
      });

    if (sharedOnly) {
      queryBuilder.andWhere(
        `(addressBook.isShared = :isShared OR ${EXTERNAL_GRANT_EXISTS})`,
        { isShared: true },
      );
    }

    if (guid) {
      queryBuilder.andWhere('addressBook.guid = :guid', { guid });
    }

    const trimmedName = name?.trim();
    if (trimmedName) {
      queryBuilder.andWhere('addressBook.name LIKE :name', {
        name: `%${trimmedName}%`,
      });
    }

    const totalRow = await queryBuilder
      .clone()
      .select('COUNT(DISTINCT addressBook.guid)', 'total')
      .getRawOne<{ total: string | number }>();

    const rowsQuery = queryBuilder
      .select('addressBook.guid', 'guid')
      .addSelect('addressBook.name', 'name')
      .addSelect('addressBook.owner', 'owner')
      .addSelect('addressBook.note', 'note')
      .addSelect(
        'MAX(CASE WHEN addressBook.owner = :userId THEN :fullControl ELSE rule.rule END)',
        'rule',
      )
      .setParameter('fullControl', ShareRule.FULL_CONTROL)
      .groupBy('addressBook.guid')
      .addGroupBy('addressBook.name')
      .addGroupBy('addressBook.owner')
      .addGroupBy('addressBook.note');

    if (!sharedOnly) {
      rowsQuery
        .addSelect('addressBook.info', 'info')
        .addGroupBy('addressBook.info');
    }

    const rows = await rowsQuery
      .orderBy('addressBook.name', 'ASC')
      .addOrderBy('addressBook.guid', 'ASC')
      .offset(skip)
      .limit(pageSize)
      .getRawMany<SharedAddressBookRow>();

    // Collect all owners (user GUIDs)
    const ownerGuids = [
      ...new Set(rows.map((row) => row.owner).filter((guid) => !!guid)),
    ];

    // Batch query user information
    const users =
      ownerGuids.length > 0
        ? await this.userRepository.find({
            where: { guid: In(ownerGuids) },
            select: ['guid', 'username'],
          })
        : [];
    const userMap = new Map(users.map((u) => [u.guid, u.username]));

    // Assemble the response data
    const data = rows.map((row) => ({
      guid: row.guid,
      name: row.name || '',
      owner: userMap.get(row.owner) || row.owner,
      note: row.note || '',
      rule: Number(row.rule),
      ...(!sharedOnly
        ? {
            info: row.info
              ? (JSON.parse(row.info) as Record<string, unknown>)
              : {},
          }
        : {}),
      ...(sharedOnly ? { is_owner: row.owner === userId } : {}),
    }));

    return { total: Number(totalRow?.total || 0), data };
  }

  /**
   * Add a shared address book
   * Create a new shared address book record
   *
   * @param name Address book name
   * @param ownerUserId Owner user ID
   * @param note Note (optional)
   * @param password Password (optional)
   * @returns GUID of the newly created address book
   * @throws ConflictException If the name already exists
   */
  async addSharedAddressBook(
    name: string,
    ownerUserId: string,
    note?: string,
    password?: string,
  ): Promise<string> {
    return this.createAddressBookProfile(
      name,
      ownerUserId,
      true,
      note,
      password,
    );
  }

  /**
   * Update a shared address book
   * Update the information of an existing shared address book
   *
   * Permission requirements:
   * - Changing name, note, or password: requires READ_WRITE permission
   * - Changing the owner: requires FULL_CONTROL permission
   *
   * @param guid Address book GUID
   * @param name New name (optional)
   * @param note New note (optional)
   * @param owner New owner (optional)
   * @param password New password (optional)
   * @param userId Current user ID
   * @throws NotFoundException Address book or user does not exist
   * @throws ForbiddenException No permission to modify
   * @throws ConflictException Name already exists
   */
  async updateSharedAddressBook(
    guid: string,
    name?: string,
    note?: string,
    owner?: string,
    password?: string,
    userId?: string,
  ): Promise<void> {
    const addressBook = await this.findSharedAddressBook(guid);

    if (!addressBook) {
      throw new NotFoundException('Address book does not exist');
    }

    // Determine whether the owner needs to be changed
    const isChangingOwner = owner !== undefined && owner !== addressBook.owner;

    // Determine the required permission level
    const requiredRule = isChangingOwner
      ? ShareRule.FULL_CONTROL
      : ShareRule.READ_WRITE;

    // Verify user permission
    if (userId) {
      await this.permissionService.checkAddressBookAccess(
        guid,
        userId,
        requiredRule,
      );
    }

    // If the owner is being changed, verify that the new owner exists
    if (isChangingOwner) {
      const newOwner = await this.userRepository.findOne({
        where: { guid: owner },
      });
      if (!newOwner) {
        throw new NotFoundException('New owner user does not exist');
      }

      // Check whether the new owner already has access to this address book
      const existingRule = await this.ruleRepository.findOne({
        where: {
          addressBookGuid: guid,
          targetUserId: owner,
          targetGroupId: IsNull(),
        },
      });

      if (!existingRule) {
        // If the new owner has no permission, grant it first
        const newRule = this.ruleRepository.create({
          guid: uuidv4(),
          addressBookGuid: guid,
          targetUserId: owner,
          rule: ShareRule.FULL_CONTROL,
        });
        await this.ruleRepository.save(newRule);
      }
    }

    // Check whether the name is already used by another address book
    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new BadRequestException('Address book name cannot be empty');
      }
      const existing = await this.addressBookRepository.findOne({
        where: {
          name: trimmedName,
          owner: owner || addressBook.owner,
          isPersonal: false,
        },
      });
      if (existing && existing.guid !== guid) {
        throw new ConflictException('Address book name already exists');
      }
      addressBook.name = trimmedName;
    }

    // Update fields
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
   * Delete shared address books
   * Delete one or more shared address books
   *
   * @param guids Array of address book GUIDs
   * @param userId User ID (owner permission required)
   * @throws ForbiddenException No permission to delete
   */
  async deleteSharedAddressBooks(
    guids: string[],
    userId: string,
  ): Promise<void> {
    const uniqueGuids = [...new Set(guids)];

    // Verify the existence and ownership of all address books up front
    const addressBooks: AddressBook[] = [];
    for (const guid of uniqueGuids) {
      const addressBook = await this.findSharedAddressBook(guid);

      if (!addressBook) {
        continue; // Skip address books that do not exist
      }

      // Check ownership
      if (addressBook.owner !== userId) {
        throw new ForbiddenException(
          `No permission to delete address book '${addressBook.name}'`,
        );
      }

      addressBooks.push(addressBook);
    }

    if (addressBooks.length === 0) {
      return;
    }

    // Batch delete address books and their associated rule records in a transaction
    const guidsToDelete = addressBooks.map((ab) => ab.guid);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(AddressBookRule).delete({
        addressBookGuid: In(guidsToDelete),
      });
      await manager.getRepository(AddressBook).delete({
        guid: In(guidsToDelete),
      });
    });
  }

  /**
   * Share the address book with other users
   * Share the address book with the specified user and set the permission level
   *
   * @param addressBookGuid Address book GUID
   * @param targetUserId Target user ID
   * @param rule Share permission level
   * @param ownerUserId Address book owner user ID
   * @returns Operation result
   * @throws ForbiddenException Thrown when the user does not have full control permission
   */
  async shareAddressBook(
    addressBookGuid: string,
    targetUserId: string,
    rule: ShareRule,
    ownerUserId: string,
  ) {
    // Verify ownership
    await this.permissionService.checkAddressBookAccess(
      addressBookGuid,
      ownerUserId,
      ShareRule.FULL_CONTROL,
    );

    // Check whether it is already shared
    let sharedRule = await this.ruleRepository.findOne({
      where: {
        addressBookGuid,
        targetUserId,
        targetGroupId: IsNull(),
      },
    });

    if (sharedRule) {
      // Already shared, update the permission level
      sharedRule.rule = rule;
    } else {
      // Not shared yet, create a new rule record
      sharedRule = this.ruleRepository.create({
        guid: uuidv4(),
        addressBookGuid,
        targetUserId,
        rule,
      });
    }

    await this.ruleRepository.save(sharedRule);
    return { message: 'Shared successfully' };
  }

  /**
   * Cancel address book sharing
   * Cancel the address book share for the specified user
   *
   * @param addressBookGuid Address book GUID
   * @param targetUserId Target user ID
   * @param ownerUserId Address book owner user ID
   * @returns Operation result
   * @throws ForbiddenException Thrown when the user does not have full control permission
   */
  async unshareAddressBook(
    addressBookGuid: string,
    targetUserId: string,
    ownerUserId: string,
  ) {
    // Verify ownership
    await this.permissionService.checkAddressBookAccess(
      addressBookGuid,
      ownerUserId,
      ShareRule.FULL_CONTROL,
    );

    // Delete the rule records
    await this.ruleRepository.delete({
      addressBookGuid,
      targetUserId,
      targetGroupId: IsNull(),
    });

    return { message: 'Share cancelled successfully' };
  }

  // ============ Private helper methods ============

  private async createAddressBookProfile(
    name: string,
    ownerUserId: string,
    isShared: boolean,
    note?: string,
    password?: string,
  ): Promise<string> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new BadRequestException('Address book name cannot be empty');
    }

    const existing = await this.addressBookRepository.findOne({
      where: {
        name: trimmedName,
        owner: ownerUserId,
        isPersonal: false,
      },
    });
    if (existing) {
      throw new ConflictException('Address book name already exists');
    }

    const addressBook = this.addressBookRepository.create({
      guid: uuidv4(),
      name: trimmedName,
      owner: ownerUserId,
      isPersonal: false,
      isShared,
      note,
      info: password ? JSON.stringify({ password }) : undefined,
    });
    await this.addressBookRepository.save(addressBook);
    return addressBook.guid;
  }

  private findPrivateCustomAddressBook(guid: string, userId: string) {
    return this.addressBookRepository
      .createQueryBuilder('addressBook')
      .where('addressBook.guid = :guid', { guid })
      .andWhere('addressBook.owner = :userId', { userId })
      .andWhere('addressBook.isPersonal = :isPersonal', {
        isPersonal: false,
      })
      .andWhere('addressBook.isShared = :isShared', { isShared: false })
      .andWhere(`NOT (${EXTERNAL_GRANT_EXISTS})`)
      .getOne();
  }

  private findSharedAddressBook(guid: string) {
    return this.addressBookRepository
      .createQueryBuilder('addressBook')
      .where('addressBook.guid = :guid', { guid })
      .andWhere('addressBook.isPersonal = :isPersonal', {
        isPersonal: false,
      })
      .andWhere(
        `(addressBook.isShared = :isShared OR ${EXTERNAL_GRANT_EXISTS})`,
        { isShared: true },
      )
      .getOne();
  }

  /**
   * Convert a rule to response format
   * @param rule Rule entity
   * @returns Object in response format
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
