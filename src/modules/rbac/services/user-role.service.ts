import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { DeviceGroup } from '../../device-group/entities/device-group.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserRoleAssignment } from '../entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from '../entities/user-role-assignment-device-group.entity';
import {
  ReplaceUserRolesDto,
  UserRoleAssignmentDto,
} from '../dto/user-role.dto';
import {
  DEVICE_SCOPED_PERMISSION_CODES,
  isKnownPermissionCode,
  PermissionCode,
} from '../constants/permission-catalog';
import { RbacAuditService } from './rbac-audit.service';
import { RbacAuthorizationService } from './rbac-authorization.service';

@Injectable()
export class UserRoleService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRoleAssignment)
    private readonly assignmentRepository: Repository<UserRoleAssignment>,
    @InjectRepository(UserRoleAssignmentDeviceGroup)
    private readonly assignmentGroupRepository: Repository<UserRoleAssignmentDeviceGroup>,
    @InjectRepository(DeviceGroup)
    private readonly deviceGroupRepository: Repository<DeviceGroup>,
    private readonly dataSource: DataSource,
    private readonly auditService: RbacAuditService,
    private readonly authorizationService: RbacAuthorizationService,
  ) {}

  async getUserRoles(userGuid: string) {
    await this.ensureUserExists(userGuid);
    const assignments = await this.loadAssignments(userGuid);
    return {
      data: assignments.map((assignment) => this.toResponse(assignment)),
      effective_scope: this.effectiveScopes(assignments),
    };
  }

  async replaceUserRoles(
    userGuid: string,
    dto: ReplaceUserRolesDto,
    actorGuid: string,
  ) {
    await this.authorizationService.requireSuperAdmin(actorGuid);
    await this.ensureUserExists(userGuid);
    const normalized = this.validateAssignments(dto.assignments);
    const roleGuids = normalized.map((assignment) => assignment.role_guid);
    const roles = roleGuids.length
      ? await this.roleRepository.find({ where: { guid: In(roleGuids) } })
      : [];
    if (roles.length !== roleGuids.length) {
      const found = new Set(roles.map((role) => role.guid));
      throw new NotFoundException(
        `角色不存在: ${roleGuids.filter((guid) => !found.has(guid)).join(', ')}`,
      );
    }
    const rolePermissions = roles.length
      ? await this.rolePermissionRepository.find({
          where: { roleGuid: In(roleGuids) },
        })
      : [];
    const permissionsByRole = this.groupPermissions(rolePermissions);
    for (const assignment of normalized) {
      const permissions = permissionsByRole.get(assignment.role_guid) || [];
      if (
        assignment.scope_type === 'device_group' &&
        permissions.some(
          (permission) => !DEVICE_SCOPED_PERMISSION_CODES.has(permission),
        )
      ) {
        throw new BadRequestException(
          'device_group scope only supports device actions and strategies.assign',
        );
      }
    }
    const groupGuids = [
      ...new Set(
        normalized.flatMap((assignment) => assignment.device_group_guids || []),
      ),
    ];
    if (groupGuids.length) {
      const groups = await this.deviceGroupRepository.find({
        where: { guid: In(groupGuids) },
        select: ['guid'],
      });
      if (groups.length !== groupGuids.length) {
        const found = new Set(groups.map((group) => group.guid));
        throw new NotFoundException(
          `设备组不存在: ${groupGuids.filter((guid) => !found.has(guid)).join(', ')}`,
        );
      }
    }
    const before = await this.getUserRoles(userGuid);
    await this.dataSource.transaction(async (manager) => {
      const current = await manager.getRepository(UserRoleAssignment).find({
        where: { userGuid },
        select: ['guid'],
      });
      if (current.length) {
        await manager.delete(UserRoleAssignmentDeviceGroup, {
          assignmentGuid: In(current.map((assignment) => assignment.guid)),
        });
      }
      await manager.delete(UserRoleAssignment, { userGuid });
      for (const assignment of normalized) {
        const saved = await manager.getRepository(UserRoleAssignment).save({
          guid: uuidv4(),
          userGuid,
          roleGuid: assignment.role_guid,
          scopeType: assignment.scope_type,
        });
        if (assignment.scope_type === 'device_group') {
          await manager.getRepository(UserRoleAssignmentDeviceGroup).insert(
            (assignment.device_group_guids || []).map((deviceGroupGuid) => ({
              assignmentGuid: saved.guid,
              deviceGroupGuid,
            })),
          );
        }
      }
      await this.auditService.record(
        {
          actorUserGuid: actorGuid,
          targetType: 'user',
          targetGuid: userGuid,
          action: 'user_role.replace',
          result: 'allowed',
          beforeState: before,
          afterState: normalized,
        },
        manager,
      );
    });
    return this.getUserRoles(userGuid);
  }

  async revokeUserRole(userGuid: string, roleGuid: string, actorGuid: string) {
    await this.authorizationService.requireSuperAdmin(actorGuid);
    await this.ensureUserExists(userGuid);
    const assignment = await this.assignmentRepository.findOne({
      where: { userGuid, roleGuid },
    });
    if (!assignment) throw new NotFoundException('用户角色分配不存在');
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserRoleAssignmentDeviceGroup, {
        assignmentGuid: assignment.guid,
      });
      await manager.delete(UserRoleAssignment, { guid: assignment.guid });
      await this.auditService.record(
        {
          actorUserGuid: actorGuid,
          targetType: 'user',
          targetGuid: userGuid,
          action: 'user_role.revoke',
          result: 'allowed',
          beforeState: {
            role_guid: roleGuid,
            scope_type: assignment.scopeType,
          },
        },
        manager,
      );
    });
    return { message: '用户角色已撤销' };
  }

  private async loadAssignments(userGuid: string) {
    const assignments = await this.assignmentRepository.find({
      where: { userGuid },
      order: { createdAt: 'ASC' },
    });
    if (!assignments.length)
      return assignments.map((assignment) => ({
        ...assignment,
        permissions: [],
        groupGuids: [],
      }));
    const roleGuids = [
      ...new Set(assignments.map((assignment) => assignment.roleGuid)),
    ];
    const assignmentGuids = assignments.map((assignment) => assignment.guid);
    const [roles, permissions, groups] = await Promise.all([
      this.roleRepository.find({ where: { guid: In(roleGuids) } }),
      this.rolePermissionRepository.find({
        where: { roleGuid: In(roleGuids) },
      }),
      this.assignmentGroupRepository.find({
        where: { assignmentGuid: In(assignmentGuids) },
      }),
    ]);
    const roleMap = new Map(roles.map((role) => [role.guid, role]));
    const permissionMap = this.groupPermissions(permissions);
    const groupMap = new Map<string, string[]>();
    for (const group of groups) {
      const values = groupMap.get(group.assignmentGuid) || [];
      values.push(group.deviceGroupGuid);
      groupMap.set(group.assignmentGuid, values);
    }
    return assignments.map((assignment) => {
      const rolePermissions = permissionMap.get(assignment.roleGuid) || [];
      return {
        ...assignment,
        role: roleMap.get(assignment.roleGuid),
        permissions:
          assignment.scopeType === 'device_group'
            ? rolePermissions.filter((permission) =>
                DEVICE_SCOPED_PERMISSION_CODES.has(permission),
              )
            : rolePermissions,
        groupGuids:
          assignment.scopeType === 'device_group'
            ? (groupMap.get(assignment.guid) || []).sort()
            : [],
      };
    });
  }

  private effectiveScopes(
    assignments: Awaited<ReturnType<UserRoleService['loadAssignments']>>,
  ) {
    const scopes: Record<
      string,
      { scope_type: 'global' | 'device_group'; device_group_guids: string[] }
    > = {};
    for (const assignment of assignments) {
      for (const permission of assignment.permissions) {
        if (!isKnownPermissionCode(permission)) continue;
        const existing = scopes[permission];
        if (existing?.scope_type === 'global') continue;
        if (!existing || assignment.scopeType === 'global') {
          scopes[permission] =
            assignment.scopeType === 'global'
              ? { scope_type: 'global', device_group_guids: [] }
              : {
                  scope_type: 'device_group',
                  device_group_guids: [...assignment.groupGuids],
                };
          continue;
        }
        scopes[permission] = {
          scope_type: 'device_group',
          device_group_guids: [
            ...new Set([
              ...existing.device_group_guids,
              ...assignment.groupGuids,
            ]),
          ].sort(),
        };
      }
    }
    return scopes;
  }

  private toResponse(
    assignment: Awaited<ReturnType<UserRoleService['loadAssignments']>>[number],
  ) {
    return {
      guid: assignment.guid,
      role_guid: assignment.roleGuid,
      role_name: assignment.role?.name || '',
      scope_type: assignment.scopeType,
      device_group_guids: assignment.groupGuids,
      permissions: assignment.permissions,
      created_at: assignment.createdAt,
      updated_at: assignment.updatedAt,
    };
  }

  private validateAssignments(assignments: UserRoleAssignmentDto[]) {
    const seen = new Set<string>();
    return assignments.map((assignment) => {
      if (seen.has(assignment.role_guid)) {
        throw new BadRequestException('同一用户不能重复分配角色');
      }
      seen.add(assignment.role_guid);
      const groups = [...new Set(assignment.device_group_guids || [])];
      if (assignment.scope_type === 'device_group' && groups.length === 0) {
        throw new BadRequestException(
          'device_group scope requires at least one device group',
        );
      }
      if (assignment.scope_type === 'global' && groups.length > 0) {
        throw new BadRequestException(
          'global scope cannot include device groups',
        );
      }
      return {
        role_guid: assignment.role_guid,
        scope_type: assignment.scope_type,
        device_group_guids:
          assignment.scope_type === 'device_group' ? groups : [],
      };
    });
  }

  private groupPermissions(rows: RolePermission[]) {
    const result = new Map<string, PermissionCode[]>();
    for (const row of rows) {
      // Damaged/legacy rows must never appear as effective permissions or be
      // echoed back as if they were part of the code-owned catalog.
      if (!isKnownPermissionCode(row.permissionCode)) continue;
      const list = result.get(row.roleGuid) || [];
      list.push(row.permissionCode);
      result.set(row.roleGuid, list);
    }
    return result;
  }

  private async ensureUserExists(userGuid: string) {
    if (!(await this.userRepository.exist({ where: { guid: userGuid } }))) {
      throw new NotFoundException('用户不存在');
    }
  }
}
