import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { AdminUserQueryDto } from './dto/admin-user.dto';
import { UserRoleAssignment } from '../rbac/entities/user-role-assignment.entity';
import { Role } from '../rbac/entities/role.entity';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Strategy)
    private strategyRepository: Repository<Strategy>,
    @InjectRepository(UserRoleAssignment)
    private assignmentRepository: Repository<UserRoleAssignment>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    private readonly authorizationService: RbacAuthorizationService,
  ) {}

  async getAdminUsers(
    query: AdminUserQueryDto,
    actorGuid: string,
  ): Promise<{ data: any[]; total: number }> {
    await this.authorizationService.getCurrentUser(actorGuid);
    const {
      current = 1,
      pageSize = 20,
      status,
      name,
      email,
      is_admin,
      third_auth_type,
      strategy_name,
      user_group_guid,
      user_group_name,
    } = query;
    const skip = (current - 1) * pageSize;

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userGroup', 'userGroup');

    if (status !== undefined) {
      queryBuilder.andWhere('user.status = :status', { status });
    }

    if (name) {
      queryBuilder.andWhere(
        '(user.username LIKE :name OR user.displayName LIKE :name)',
        { name: `%${name}%` },
      );
    }

    if (email) {
      queryBuilder.andWhere('user.email LIKE :email', { email: `%${email}%` });
    }

    if (is_admin !== undefined) {
      queryBuilder.andWhere('user.isAdmin = :isAdmin', {
        isAdmin: is_admin === 1,
      });
    }

    if (third_auth_type) {
      queryBuilder.andWhere('user.thirdAuthType = :thirdAuthType', {
        thirdAuthType: third_auth_type,
      });
    }

    if (strategy_name) {
      queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM strategies s
          WHERE s.guid = user.strategyGuid AND s.name LIKE :strategyName
        )`,
        { strategyName: `%${strategy_name}%` },
      );
    }

    if (user_group_guid) {
      queryBuilder.andWhere('user.userGroupGuid = :userGroupGuid', {
        userGroupGuid: user_group_guid,
      });
    }

    if (user_group_name && !user_group_guid) {
      queryBuilder.andWhere('userGroup.name LIKE :userGroupName', {
        userGroupName: `%${user_group_name}%`,
      });
    }

    const [users, total] = await queryBuilder
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    // Batch load strategy names
    const strategyGuids = [
      ...new Set(
        users.map((u) => u.strategyGuid).filter((g): g is string => g != null),
      ),
    ];
    const strategies =
      strategyGuids.length > 0
        ? await this.strategyRepository.find({
            where: strategyGuids.map((guid) => ({ guid })),
          })
        : [];
    const strategyMap = new Map(strategies.map((s) => [s.guid, s.name]));

    const roleNamesByUser = new Map<string, string[]>();
    const protectedUsers = new Set(
      users.filter((user) => user.isAdmin).map((user) => user.guid),
    );
    if (users.length > 0) {
      const assignments = await this.assignmentRepository.find({
        where: { userGuid: In(users.map((user) => user.guid)) },
        select: ['userGuid', 'roleGuid'],
      });
      const roleGuids = [
        ...new Set(assignments.map((assignment) => assignment.roleGuid)),
      ];
      const roles = roleGuids.length
        ? await this.roleRepository.find({
            where: { guid: In(roleGuids) },
            select: ['guid', 'name', 'protectedAccount'],
          })
        : [];
      const roleNameByGuid = new Map(
        roles.map((role) => [role.guid, role.name]),
      );
      const roleNameSetsByUser = new Map<string, Set<string>>();
      for (const assignment of assignments) {
        const role = roles.find(
          (candidate) => candidate.guid === assignment.roleGuid,
        );
        if (role?.protectedAccount) protectedUsers.add(assignment.userGuid);
        const roleName = roleNameByGuid.get(assignment.roleGuid);
        if (!roleName) continue;
        const roleNames =
          roleNameSetsByUser.get(assignment.userGuid) ?? new Set();
        roleNames.add(roleName);
        roleNameSetsByUser.set(assignment.userGuid, roleNames);
      }
      for (const [userGuid, roleNames] of roleNameSetsByUser) {
        roleNamesByUser.set(userGuid, [...roleNames].sort());
      }
    }

    return {
      data: users.map((u) => ({
        guid: u.guid,
        name: u.username,
        display_name: u.displayName || '',
        email: u.email || '',
        note: u.note || '',
        status: u.status,
        is_admin: u.isAdmin,
        is_protected: protectedUsers.has(u.guid),
        third_auth_type: u.thirdAuthType || '',
        strategy_guid: u.strategyGuid || '',
        strategy_name: u.strategyGuid
          ? strategyMap.get(u.strategyGuid) || ''
          : '',
        user_group_guid: u.userGroupGuid || '',
        user_group_name: u.userGroup?.name || '',
        avatar: u.avatar || '',
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        role_names: [
          ...(u.isAdmin ? ['Super Admin'] : []),
          ...(roleNamesByUser.get(u.guid) ?? []),
        ],
      })),
      total,
    };
  }
}
