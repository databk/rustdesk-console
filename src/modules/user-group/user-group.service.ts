import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AddressBookRule } from '../address-book/entities/address-book-rule.entity';
import { User } from '../user/entities/user.entity';
import {
  CreateUserGroupDto,
  UpdateUserGroupDto,
  UserGroupQueryDto,
} from './dto/user-group.dto';
import { UserGroup } from './entities/user-group.entity';

const DEFAULT_USER_GROUP_NAME = 'Default';

type UserGroupWithCount = UserGroup & { userCount?: number };

@Injectable()
export class UserGroupService {
  private readonly logger = new Logger(UserGroupService.name);

  constructor(
    @InjectRepository(UserGroup)
    private readonly userGroupRepository: Repository<UserGroup>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AddressBookRule)
    private readonly ruleRepository: Repository<AddressBookRule>,
    private readonly dataSource: DataSource,
  ) {}

  async initializeStorage(): Promise<UserGroup> {
    const defaultGroup = await this.ensureDefaultGroup();

    const backfillResult = await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ userGroupGuid: defaultGroup.guid })
      .where('"userGroupGuid" IS NULL')
      .orWhere('"userGroupGuid" NOT IN (SELECT "guid" FROM "user_groups")')
      .execute();

    const emptyUserTargets = await this.ruleRepository
      .createQueryBuilder()
      .update(AddressBookRule)
      .set({ targetUserId: null })
      .where('"targetUserId" = :empty', { empty: '' })
      .execute();

    const emptyGroupTargets = await this.ruleRepository
      .createQueryBuilder()
      .update(AddressBookRule)
      .set({ targetGroupId: null })
      .where('"targetGroupId" = :empty', { empty: '' })
      .execute();

    const invalidGroupTargets = await this.ruleRepository
      .createQueryBuilder()
      .delete()
      .from(AddressBookRule)
      .where('"targetGroupId" IS NOT NULL')
      .andWhere('"targetGroupId" NOT IN (SELECT "guid" FROM "user_groups")')
      .execute();

    if (backfillResult.affected) {
      this.logger.log(
        `Assigned ${backfillResult.affected} existing users to the default group`,
      );
    }

    const normalizedTargetCount =
      (emptyUserTargets.affected || 0) + (emptyGroupTargets.affected || 0);
    if (normalizedTargetCount > 0) {
      this.logger.log(
        `Normalized ${normalizedTargetCount} legacy address-book rule targets`,
      );
    }
    if (invalidGroupTargets.affected) {
      this.logger.warn(
        `Removed ${invalidGroupTargets.affected} address-book rules with unknown user groups`,
      );
    }

    return defaultGroup;
  }

  async ensureDefaultGroup(): Promise<UserGroup> {
    const existingDefault = await this.userGroupRepository.findOne({
      where: { isDefault: true },
    });
    if (existingDefault) {
      return existingDefault;
    }

    const { name, normalizedName } = this.normalizeName(
      DEFAULT_USER_GROUP_NAME,
    );
    const existingNamedGroup = await this.userGroupRepository.findOne({
      where: { normalizedName },
    });

    if (existingNamedGroup) {
      existingNamedGroup.isDefault = true;
      return this.userGroupRepository.save(existingNamedGroup);
    }

    const defaultGroup = this.userGroupRepository.create({
      guid: uuidv4(),
      name,
      normalizedName,
      note: null,
      isDefault: true,
    });

    try {
      const saved = await this.userGroupRepository.save(defaultGroup);
      this.logger.log(`Default user group created: ${saved.guid}`);
      return saved;
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        const concurrentDefault = await this.userGroupRepository.findOne({
          where: { isDefault: true },
        });
        if (concurrentDefault) {
          return concurrentDefault;
        }
      }
      throw error;
    }
  }

  async resolveUserGroupGuid(userGroupGuid?: string): Promise<string> {
    if (!userGroupGuid) {
      return (await this.ensureDefaultGroup()).guid;
    }
    return (await this.requireGroup(userGroupGuid)).guid;
  }

  async requireGroup(guid: string): Promise<UserGroup> {
    const group = await this.userGroupRepository.findOne({ where: { guid } });
    if (!group) {
      throw new NotFoundException('用户组不存在');
    }
    return group;
  }

  async getGroups(query: UserGroupQueryDto) {
    const { current = 1, pageSize = 20, search } = query;
    const queryBuilder = this.userGroupRepository
      .createQueryBuilder('userGroup')
      .loadRelationCountAndMap('userGroup.userCount', 'userGroup.users');

    const normalizedSearch = search?.trim().toLowerCase();
    if (normalizedSearch) {
      queryBuilder.andWhere('userGroup.normalizedName LIKE :search', {
        search: `%${normalizedSearch}%`,
      });
    }

    const [groups, total] = await queryBuilder
      .orderBy('userGroup.normalizedName', 'ASC')
      .addOrderBy('userGroup.guid', 'ASC')
      .skip((current - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data: (groups as UserGroupWithCount[]).map((group) =>
        this.toGroupResponse(group, group.userCount || 0),
      ),
      total,
    };
  }

  async createGroup(dto: CreateUserGroupDto) {
    const { name, normalizedName } = this.normalizeName(dto.name);
    await this.assertNameAvailable(normalizedName);

    const group = this.userGroupRepository.create({
      guid: uuidv4(),
      name,
      normalizedName,
      note: this.normalizeNote(dto.note),
      isDefault: false,
    });

    try {
      const saved = await this.userGroupRepository.save(group);
      return this.toGroupResponse(saved, 0);
    } catch (error: unknown) {
      this.rethrowUniqueName(error);
    }
  }

  async updateGroup(guid: string, dto: UpdateUserGroupDto) {
    const group = await this.requireGroup(guid);

    if (dto.name !== undefined) {
      const { name, normalizedName } = this.normalizeName(dto.name);
      await this.assertNameAvailable(normalizedName, guid);
      group.name = name;
      group.normalizedName = normalizedName;
    }

    if (dto.note !== undefined) {
      group.note = this.normalizeNote(dto.note);
    }

    try {
      const saved = await this.userGroupRepository.save(group);
      const userCount = await this.userRepository.count({
        where: { userGroupGuid: guid },
      });
      return this.toGroupResponse(saved, userCount);
    } catch (error: unknown) {
      this.rethrowUniqueName(error);
    }
  }

  async deleteGroup(guid: string) {
    return this.dataSource.transaction(async (manager) => {
      const groupRepository = manager.getRepository(UserGroup);
      const userRepository = manager.getRepository(User);
      const ruleRepository = manager.getRepository(AddressBookRule);

      const group = await groupRepository.findOne({ where: { guid } });
      if (!group) {
        throw new NotFoundException('用户组不存在');
      }
      if (group.isDefault) {
        throw new BadRequestException('默认用户组不能删除');
      }

      const defaultGroup = await groupRepository.findOne({
        where: { isDefault: true },
      });
      if (!defaultGroup) {
        throw new BadRequestException('默认用户组不存在');
      }

      const movedUsers = await userRepository.update(
        { userGroupGuid: guid },
        { userGroupGuid: defaultGroup.guid },
      );
      const deletedRules = await ruleRepository.delete({
        targetGroupId: guid,
      });
      await groupRepository.delete({ guid });

      return {
        message: '用户组删除成功',
        moved_user_count: movedUsers.affected || 0,
        deleted_rule_count: deletedRules.affected || 0,
      };
    });
  }

  async getGroupUsers(guid: string, query: UserGroupQueryDto) {
    const group = await this.requireGroup(guid);
    const { current = 1, pageSize = 20, search } = query;
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .where('user.userGroupGuid = :guid', { guid });

    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      queryBuilder.andWhere(
        '(user.username LIKE :search OR user.email LIKE :search)',
        { search: `%${trimmedSearch}%` },
      );
    }

    const [users, total] = await queryBuilder
      .orderBy('user.username', 'ASC')
      .addOrderBy('user.guid', 'ASC')
      .skip((current - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data: users.map((user) => ({
        guid: user.guid,
        name: user.username,
        email: user.email || '',
        note: user.note || '',
        status: user.status,
        is_admin: user.isAdmin,
        user_group_guid: group.guid,
        user_group_name: group.name,
      })),
      total,
    };
  }

  async moveUsers(guid: string, userGuids: string[]) {
    const uniqueGuids = [...new Set(userGuids)];

    return this.dataSource.transaction(async (manager) => {
      const groupRepository = manager.getRepository(UserGroup);
      const userRepository = manager.getRepository(User);

      const group = await groupRepository.findOne({ where: { guid } });
      if (!group) {
        throw new NotFoundException('用户组不存在');
      }

      const users = await userRepository.find({
        where: { guid: In(uniqueGuids) },
        select: ['guid', 'userGroupGuid'],
      });
      if (users.length !== uniqueGuids.length) {
        throw new NotFoundException('一个或多个用户不存在');
      }

      const guidsToMove = users
        .filter((user) => user.userGroupGuid !== guid)
        .map((user) => user.guid);

      if (guidsToMove.length > 0) {
        await userRepository.update(
          { guid: In(guidsToMove) },
          { userGroupGuid: guid },
        );
      }

      return {
        message: '用户组成员已更新',
        moved_user_count: guidsToMove.length,
      };
    });
  }

  private normalizeName(value: string) {
    const name = value.trim();
    if (!name) {
      throw new BadRequestException('用户组名称不能为空');
    }
    return { name, normalizedName: name.toLowerCase() };
  }

  private normalizeNote(value?: string): string | null {
    if (value === undefined) {
      return null;
    }
    const note = value.trim();
    return note || null;
  }

  private async assertNameAvailable(
    normalizedName: string,
    ignoredGuid?: string,
  ): Promise<void> {
    const existing = await this.userGroupRepository.findOne({
      where: { normalizedName },
    });
    if (existing && existing.guid !== ignoredGuid) {
      throw new ConflictException('用户组名称已存在');
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      error.message.toUpperCase().includes('UNIQUE')
    );
  }

  private rethrowUniqueName(error: unknown): never {
    if (this.isUniqueConstraintError(error)) {
      throw new ConflictException('用户组名称已存在');
    }
    throw error;
  }

  private toGroupResponse(group: UserGroup, userCount: number) {
    return {
      guid: group.guid,
      name: group.name,
      note: group.note || '',
      user_count: userCount,
      is_default: group.isDefault,
      created_at: group.createdAt,
      updated_at: group.updatedAt,
    };
  }
}
