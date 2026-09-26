import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserRoleAssignment } from '../entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from '../entities/user-role-assignment-device-group.entity';
import { CreateRoleDto, RoleQueryDto, UpdateRoleDto } from '../dto/role.dto';
import {
  filterEffectivePermissionCodes,
  getPermissionRequirements,
  PermissionCode,
  isDeviceGroupScopedPermission,
  isAssignablePermissionCode,
} from '../constants/permission-catalog';
import { RbacAuditService } from './rbac-audit.service';
import { RbacAuthorizationService } from './rbac-authorization.service';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRoleAssignment)
    private readonly assignmentRepository: Repository<UserRoleAssignment>,
    @InjectRepository(UserRoleAssignmentDeviceGroup)
    private readonly assignmentGroupRepository: Repository<UserRoleAssignmentDeviceGroup>,
    private readonly dataSource: DataSource,
    private readonly auditService: RbacAuditService,
    private readonly authorizationService: RbacAuthorizationService,
  ) {}

  async listRoles(query: RoleQueryDto) {
    const current = query.current || 1;
    const pageSize = query.pageSize || 20;
    const builder = this.roleRepository.createQueryBuilder('role');
    if (query.name) {
      builder.andWhere('role.name LIKE :name', {
        name: `%${query.name}%`,
      });
    }
    if (query.note) {
      builder.andWhere('role.note LIKE :note', {
        note: `%${query.note}%`,
      });
    }
    const [roles, total] = await builder
      .orderBy('role.name', 'ASC')
      .addOrderBy('role.guid', 'ASC')
      .skip((current - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const permissions = roles.length
      ? await this.rolePermissionRepository.find({
          where: { roleGuid: In(roles.map((role) => role.guid)) },
        })
      : [];
    const permissionMap = this.groupPermissions(permissions);
    return {
      data: roles.map((role) =>
        this.toResponse(role, permissionMap.get(role.guid) || []),
      ),
      total,
    };
  }

  async getRole(guid: string) {
    const role = await this.requireRole(guid);
    return this.toResponse(role, await this.loadPermissionCodes(guid));
  }

  async getProtectionImpact(guid: string, actorGuid: string) {
    await this.authorizationService.requireSuperAdmin(actorGuid);
    const role = await this.requireRole(guid);
    return {
      guid,
      protected_account: role.protectedAccount === true,
      affected_member_count: await this.assignmentRepository.count({
        where: { roleGuid: guid },
      }),
    };
  }

  async createRole(dto: CreateRoleDto, actorGuid: string) {
    const name = this.normalizeName(dto.name);
    const permissions = this.validatePermissions(dto.permissions);
    await this.ensureNameAvailable(name);
    return this.dataSource.transaction(async (manager) => {
      await this.authorizationService.requireSuperAdmin(actorGuid, manager);
      const role = manager.getRepository(Role).create({
        guid: uuidv4(),
        name,
        note: dto.note?.trim() || null,
        protectedAccount: dto.protected_account === true,
      });
      try {
        await manager.getRepository(Role).save(role);
      } catch (error: unknown) {
        if (this.isUniqueError(error))
          throw new ConflictException('Role name already exists');
        throw error;
      }
      await this.replacePermissionsWithManager(manager, role.guid, permissions);
      await this.auditService.record(
        {
          actorUserGuid: actorGuid,
          targetType: 'role',
          targetGuid: role.guid,
          action: 'role.create',
          result: 'allowed',
          afterState: {
            name: role.name,
            note: role.note,
            permissions,
            protected_account: role.protectedAccount,
          },
        },
        manager,
      );
      return this.toResponse(role, permissions);
    });
  }

  async updateRole(guid: string, dto: UpdateRoleDto, actorGuid: string) {
    // Reject malformed permission edits before opening a transaction. The
    // same checks are repeated against the transaction snapshot below.
    if (dto.permissions !== undefined) {
      const candidate = this.validatePermissions(dto.permissions);
      await this.ensureScopedAssignmentsRemainValid(guid, candidate);
    }
    return this.dataSource.transaction(async (manager) => {
      await this.authorizationService.requireSuperAdmin(actorGuid, manager);
      const roleRepository = manager.getRepository(Role);
      const permissionRepository = manager.getRepository(RolePermission);
      const assignmentRepository = manager.getRepository(UserRoleAssignment);
      const role = await roleRepository.findOne({
        where: { guid },
      });
      if (!role) throw new NotFoundException('Role not found');
      const beforePermissions = (
        await permissionRepository.find({
          where: { roleGuid: guid },
        })
      )
        .map((row) => row.permissionCode)
        .filter(isAssignablePermissionCode)
        .sort();
      const beforeName = role.name;
      const beforeNote = role.note;
      const beforeProtected = role.protectedAccount === true;
      const name =
        dto.name === undefined ? role.name : this.normalizeName(dto.name);
      if (name !== role.name) {
        const existing = await roleRepository
          .createQueryBuilder('role')
          .where('LOWER(role.name) = LOWER(:name)', { name })
          .getOne();
        if (existing && existing.guid !== guid) {
          throw new ConflictException('Role name already exists');
        }
      }
      const permissions =
        dto.permissions === undefined
          ? beforePermissions
          : this.validatePermissions(dto.permissions);
      if (dto.permissions !== undefined) {
        await this.ensureScopedAssignmentsRemainValid(
          guid,
          permissions,
          manager,
        );
      }
      const nextProtected =
        dto.protected_account === undefined
          ? beforeProtected
          : dto.protected_account;
      if (
        dto.protected_account !== undefined &&
        nextProtected !== beforeProtected
      ) {
        const affectedCount = await assignmentRepository.count({
          where: { roleGuid: guid },
        });
        if (
          !nextProtected &&
          affectedCount > 0 &&
          dto.confirm_protected_account_change !== true
        ) {
          throw new BadRequestException(
            `Removing role protection will affect ${affectedCount} accounts, please confirm and retry`,
          );
        }
        role.protectedAccount = nextProtected;
      }
      role.name = name;
      if (dto.note !== undefined) role.note = dto.note.trim() || null;
      await roleRepository.save(role);
      if (dto.permissions !== undefined) {
        await this.replacePermissionsWithManager(manager, guid, permissions);
      }
      await this.auditService.record(
        {
          actorUserGuid: actorGuid,
          targetType: 'role',
          targetGuid: guid,
          action: 'role.update',
          result: 'allowed',
          beforeState: {
            name: beforeName,
            note: beforeNote,
            permissions: beforePermissions,
            protected_account: beforeProtected,
          },
          afterState: {
            name: role.name,
            note: role.note,
            permissions,
            protected_account: role.protectedAccount,
            ...(dto.protected_account !== undefined && !role.protectedAccount
              ? {
                  affected_member_count: await assignmentRepository.count({
                    where: { roleGuid: guid },
                  }),
                }
              : {}),
          },
        },
        manager,
      );
      return this.toResponse(role, permissions);
    });
  }

  async deleteRole(guid: string, actorGuid: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.authorizationService.requireSuperAdmin(actorGuid, manager);
      const roleRepository = manager.getRepository(Role);
      const permissionRepository = manager.getRepository(RolePermission);
      const assignmentRepository = manager.getRepository(UserRoleAssignment);
      const assignmentGroupRepository = manager.getRepository(
        UserRoleAssignmentDeviceGroup,
      );
      const role = await roleRepository.findOne({ where: { guid } });
      if (!role) throw new NotFoundException('Role not found');

      // Take the complete pre-delete snapshot in the same transaction as the
      // destructive writes so the audit record explains exactly which grants
      // and scopes were revoked.
      const [permissionRows, assignments] = await Promise.all([
        permissionRepository.find({
          where: { roleGuid: guid },
          select: ['permissionCode'],
        }),
        assignmentRepository.find({
          where: { roleGuid: guid },
          select: ['guid', 'userGuid', 'scopeType'],
        }),
      ]);
      const assignmentGuids = assignments.map((assignment) => assignment.guid);
      const assignmentGroups = assignmentGuids.length
        ? await assignmentGroupRepository.find({
            where: { assignmentGuid: In(assignmentGuids) },
            select: ['assignmentGuid', 'deviceGroupGuid'],
          })
        : [];
      const groupsByAssignment = new Map<string, string[]>();
      for (const group of assignmentGroups) {
        const groups = groupsByAssignment.get(group.assignmentGuid) || [];
        groups.push(group.deviceGroupGuid);
        groupsByAssignment.set(group.assignmentGuid, groups);
      }
      const beforeState = {
        name: role.name,
        note: role.note,
        permissions: permissionRows
          .map((permission) => permission.permissionCode)
          .filter(isAssignablePermissionCode)
          .sort(),
        protected_account: role.protectedAccount === true,
        assignments: assignments
          .map((assignment) => ({
            guid: assignment.guid,
            user_guid: assignment.userGuid,
            scope_type: assignment.scopeType,
            device_group_guids: [
              ...(groupsByAssignment.get(assignment.guid) || []),
            ].sort(),
          }))
          .sort((left, right) => left.guid.localeCompare(right.guid)),
      };

      if (assignments.length) {
        await assignmentGroupRepository.delete({
          assignmentGuid: In(assignments.map((assignment) => assignment.guid)),
        });
        await assignmentRepository.delete({ roleGuid: guid });
      }
      await permissionRepository.delete({ roleGuid: guid });
      await roleRepository.delete({ guid });
      await this.auditService.record(
        {
          actorUserGuid: actorGuid,
          targetType: 'role',
          targetGuid: guid,
          action: 'role.delete',
          result: 'allowed',
          beforeState,
        },
        manager,
      );
    });
  }

  private async loadPermissionCodes(guid: string): Promise<PermissionCode[]> {
    const rows = await this.rolePermissionRepository.find({
      where: { roleGuid: guid },
    });
    return rows
      .map((row) => row.permissionCode)
      .filter(isAssignablePermissionCode)
      .sort();
  }

  private async requireRole(guid: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { guid } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private normalizeName(value: string): string {
    const name = value.trim();
    if (!name) throw new BadRequestException('Role name cannot be empty');
    return name;
  }

  private async ensureNameAvailable(name: string, ignoredGuid?: string) {
    const existing = await this.roleRepository
      .createQueryBuilder('role')
      .where('LOWER(role.name) = LOWER(:name)', { name })
      .getOne();
    if (existing && existing.guid !== ignoredGuid) {
      throw new ConflictException('Role name already exists');
    }
  }

  private validatePermissions(permissions: string[]): PermissionCode[] {
    const unique = [...new Set(permissions)];
    const systemOnly = unique.filter(
      (permission) => !isAssignablePermissionCode(permission),
    );
    if (systemOnly.length) {
      throw new BadRequestException(
        `Permission code cannot be assigned: ${systemOnly.join(', ')}`,
      );
    }
    const validated = unique.filter(isAssignablePermissionCode).sort();
    const granted = new Set(validated);
    const missing = validated.flatMap((permission) =>
      getPermissionRequirements(permission)
        .filter((required) => !granted.has(required))
        .map((required) => `${permission} requires ${required}`),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Missing permission dependencies: ${missing.join(', ')}`,
      );
    }
    return validated;
  }

  private async ensureScopedAssignmentsRemainValid(
    roleGuid: string,
    permissions: PermissionCode[],
    manager?: import('typeorm').EntityManager,
  ): Promise<void> {
    if (
      permissions.length > 0 &&
      permissions.every((permission) =>
        isDeviceGroupScopedPermission(permission),
      )
    ) {
      return;
    }
    const hasScopedAssignment = await (
      manager?.getRepository(UserRoleAssignment) ?? this.assignmentRepository
    ).exist({
      where: { roleGuid, scopeType: 'device_group' },
    });
    if (hasScopedAssignment) {
      throw new BadRequestException(
        'Roles with advanced scope grants can only contain device operations and strategies.assign',
      );
    }
  }

  private async replacePermissionsWithManager(
    manager: import('typeorm').EntityManager,
    roleGuid: string,
    permissions: string[],
  ) {
    await manager.delete(RolePermission, { roleGuid });
    if (permissions.length) {
      await manager.insert(
        RolePermission,
        permissions.map((permissionCode) => ({ roleGuid, permissionCode })),
      );
    }
  }

  private groupPermissions(rows: RolePermission[]) {
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const list = result.get(row.roleGuid) || [];
      if (isAssignablePermissionCode(row.permissionCode))
        list.push(row.permissionCode);
      result.set(row.roleGuid, list);
    }
    return new Map(
      [...result].map(([roleGuid, permissions]) => [
        roleGuid,
        filterEffectivePermissionCodes(permissions),
      ]),
    );
  }

  private toResponse(role: Role, permissions: string[]) {
    return {
      guid: role.guid,
      name: role.name,
      note: role.note || '',
      permissions,
      created_at: role.createdAt,
      updated_at: role.updatedAt,
      protected_account: role.protectedAccount === true,
    };
  }

  private isUniqueError(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      error.message.toUpperCase().includes('UNIQUE')
    );
  }
}
