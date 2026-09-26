import {
  BadRequestException,
  ForbiddenException,
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
  filterEffectivePermissionCodes,
  isAssignablePermissionCode,
  isDeviceGroupScopedPermission,
  PERMISSION_CATALOG,
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

  async getUserRoles(
    userGuid: string,
    manager?: import('typeorm').EntityManager,
  ) {
    await this.ensureUserExists(manager, userGuid);
    const assignments = await this.loadAssignments(userGuid, manager);
    return {
      data: assignments.map((assignment) => this.toResponse(assignment)),
      effective_scope: this.effectiveScopes(assignments),
    };
  }

  /** Return every role with target-specific, stable delegation decisions. */
  async getRoleEligibility(userGuid: string, actorGuid: string) {
    const target = await this.userRepository.findOne({
      where: { guid: userGuid },
      select: ['guid', 'isAdmin'],
    });
    if (!target) throw new NotFoundException('User does not exist');
    const actor = await this.authorizationService.getCurrentUser(actorGuid);
    const roles = await this.roleRepository.find({ order: { name: 'ASC' } });
    const assignments = await this.loadAssignments(userGuid);
    const assigned = new Set(
      assignments.map((assignment) => assignment.roleGuid),
    );
    const owner = actor.isAdmin === true;
    const actorScopes = new Map<
      PermissionCode,
      { global: boolean; groups: Set<string> }
    >();
    if (!owner) {
      const grants =
        await this.authorizationService.getEffectivePermissions(actorGuid);
      for (const permission of PERMISSION_CATALOG) {
        if (!isAssignablePermissionCode(permission.code)) continue;
        const scope = grants.scopes[permission.code];
        if (scope)
          actorScopes.set(permission.code, {
            global: scope.scope_type === 'global',
            groups: new Set(scope.device_group_guids),
          });
      }
    }
    const roleRows = await this.rolePermissionRepository.find({
      where: roles.length
        ? { roleGuid: In(roles.map((role) => role.guid)) }
        : [],
    });
    const permissionMap = this.groupPermissions(roleRows);
    const allGroups = await this.deviceGroupRepository.find({
      select: ['guid', 'name'],
      order: { name: 'ASC' },
    });
    const selfTarget = userGuid === actorGuid;
    const protectedTarget = await this.authorizationService.isProtectedUser(
      userGuid,
      target.isAdmin,
    );
    return {
      data: roles.map((role) => {
        const permissions = permissionMap.get(role.guid) || [];
        const locked =
          role.protectedAccount === true ||
          permissions.includes('roles.assign');
        let reason_code: string | null = null;
        if (target.isAdmin) reason_code = 'super_admin_target';
        else if (!owner && selfTarget) reason_code = 'self_target';
        else if (!owner && protectedTarget) reason_code = 'protected_target';
        else if (!owner && locked)
          reason_code = role.protectedAccount
            ? 'protected_role'
            : 'role_grants_roles_assign';
        else if (!owner) {
          for (const permission of permissions) {
            const callerScope = actorScopes.get(permission);
            if (!callerScope) {
              reason_code = 'missing_permission';
              break;
            }
            if (callerScope.global) continue;
            const definition = PERMISSION_CATALOG.find(
              (item) => item.code === permission,
            );
            if (definition?.scope !== 'device_group') {
              reason_code = 'scope_exceeds_caller';
              break;
            }
          }
        }
        const globalAllowed =
          owner ||
          (permissions.length > 0 &&
            permissions.every(
              (permission) => actorScopes.get(permission)?.global === true,
            ));
        const allowedGroupGuids = new Set(allGroups.map((group) => group.guid));
        const allPermissionsDeviceScoped =
          permissions.length > 0 &&
          permissions.every(
            (permission) =>
              PERMISSION_CATALOG.find((item) => item.code === permission)
                ?.scope === 'device_group',
          );
        if (allPermissionsDeviceScoped && !owner) {
          for (const permission of permissions) {
            const callerScope = actorScopes.get(permission);
            if (!callerScope) continue;
            if (!callerScope.global) {
              for (const guid of [...allowedGroupGuids]) {
                if (!callerScope.groups.has(guid))
                  allowedGroupGuids.delete(guid);
              }
            }
          }
        } else if (!allPermissionsDeviceScoped) {
          allowedGroupGuids.clear();
        }
        const scopeExceeds =
          !globalAllowed &&
          !(allPermissionsDeviceScoped && allowedGroupGuids.size > 0);
        if (!reason_code && scopeExceeds) reason_code = 'scope_exceeds_caller';
        const canAssign = reason_code === null;
        const canRemove = assigned.has(role.guid) && canAssign;
        const allowedScopeTypes: Array<'global' | 'device_group'> = [];
        if (canAssign) {
          if (globalAllowed) allowedScopeTypes.push('global');
          if (allPermissionsDeviceScoped && allowedGroupGuids.size > 0) {
            allowedScopeTypes.push('device_group');
          }
        }
        return {
          guid: role.guid,
          name: role.name,
          protected_account: role.protectedAccount === true,
          assigned: assigned.has(role.guid),
          can_assign: canAssign,
          can_remove: canRemove,
          reason_code,
          allowed_scope_types: allowedScopeTypes,
          assignable_device_groups:
            canAssign && allPermissionsDeviceScoped
              ? allGroups
                  .filter((group) => allowedGroupGuids.has(group.guid))
                  .map((group) => ({ guid: group.guid, name: group.name }))
              : [],
        };
      }),
    };
  }

  async replaceUserRoles(
    userGuid: string,
    dto: ReplaceUserRolesDto,
    actorGuid: string,
  ) {
    const normalized = this.validateAssignments(dto.assignments);
    const requestedRoleGuids = new Set(
      normalized.map((assignment) => assignment.role_guid),
    );
    const roleGuids = normalized.map((assignment) => assignment.role_guid);
    const roles = roleGuids.length
      ? await this.roleRepository.find({ where: { guid: In(roleGuids) } })
      : [];
    if (roles.length !== roleGuids.length) {
      const found = new Set(roles.map((role) => role.guid));
      throw new NotFoundException(
        `Role not found: ${roleGuids.filter((guid) => !found.has(guid)).join(', ')}`,
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
        (permissions.length === 0 ||
          permissions.some(
            (permission) => !isDeviceGroupScopedPermission(permission),
          ))
      ) {
        throw new BadRequestException(
          'device_group scope only supports device actions and strategies.assign',
        );
      }
    }
    const actor = await this.authorizationService.getCurrentUser(actorGuid);
    const owner = actor.isAdmin === true;
    if (!owner)
      await this.authorizationService.requirePermission(
        actorGuid,
        'roles.assign',
      );
    await this.ensureUserExists(undefined, userGuid);
    const target = await this.userRepository.findOne({
      where: { guid: userGuid },
      select: ['guid', 'isAdmin'],
    });
    if (!target && !owner) throw new NotFoundException('User does not exist');
    if (target?.isAdmin) {
      throw new ForbiddenException(
        'Super administrators cannot be assigned regular roles',
      );
    }
    if (
      !owner &&
      (userGuid === actorGuid ||
        (await this.authorizationService.isProtectedUser(
          userGuid,
          target?.isAdmin,
        )))
    ) {
      throw new ForbiddenException(
        userGuid === actorGuid
          ? 'You cannot modify your own roles'
          : 'Protected accounts can only be modified by a super administrator',
      );
    }
    if (!owner) {
      const current = await this.loadAssignments(userGuid);
      const eligibility = await this.getRoleEligibility(userGuid, actorGuid);
      const lockedCurrent = eligibility.data.filter(
        (row) => row.assigned && !row.can_remove,
      );
      const omitted = lockedCurrent.find(
        (row) => !requestedRoleGuids.has(row.guid),
      );
      if (omitted)
        throw new ForbiddenException(
          `Cannot remove protected role: ${omitted.guid}`,
        );
      const denied = normalized.find((assignment) => {
        const row = eligibility.data.find(
          (candidate) => candidate.guid === assignment.role_guid,
        );
        return (
          !row?.can_assign &&
          !current.some(
            (existing) => existing.roleGuid === assignment.role_guid,
          )
        );
      });
      if (denied)
        throw new ForbiddenException(
          `Role cannot be assigned: ${denied.role_guid}`,
        );
      const caller =
        await this.authorizationService.getEffectivePermissions(actorGuid);
      const proposed = new Map<
        PermissionCode,
        { global: boolean; groups: Set<string> }
      >();
      for (const assignment of normalized) {
        const perms = permissionsByRole.get(assignment.role_guid) || [];
        for (const permission of perms) {
          const entry = proposed.get(permission) || {
            global: false,
            groups: new Set<string>(),
          };
          if (assignment.scope_type === 'global') entry.global = true;
          else
            for (const group of assignment.device_group_guids || [])
              entry.groups.add(group);
          proposed.set(permission, entry);
        }
      }
      for (const [permission, grant] of proposed) {
        const allowed = caller.scopes[permission];
        if (
          !allowed ||
          (grant.global && allowed.scope_type !== 'global') ||
          (!grant.global &&
            allowed.scope_type === 'device_group' &&
            ![...grant.groups].every((group) =>
              allowed.device_group_guids.includes(group),
            ))
        ) {
          throw new ForbiddenException(
            `Role permissions exceed the operator scope: ${permission}`,
          );
        }
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
        throw new BadRequestException(
          `Device group not found: ${groupGuids.filter((guid) => !found.has(guid)).join(', ')}`,
        );
      }
    }
    await this.dataSource.transaction(async (manager) => {
      const currentActor = await this.authorizationService.getCurrentUser(
        actorGuid,
        manager,
      );
      const currentOwner = currentActor.isAdmin === true;
      if (!currentOwner) {
        await this.authorizationService.requirePermission(
          actorGuid,
          'roles.assign',
          manager,
        );
      }
      const currentTarget = await manager
        .getRepository(User)
        .findOne({ where: { guid: userGuid }, select: ['guid', 'isAdmin'] });
      if (!currentTarget) throw new NotFoundException('User does not exist');
      if (currentTarget.isAdmin) {
        throw new ForbiddenException(
          'Super administrators cannot be assigned regular roles',
        );
      }
      if (
        !currentOwner &&
        (await this.authorizationService.isProtectedUser(
          userGuid,
          currentTarget.isAdmin,
          manager,
        ))
      ) {
        throw new ForbiddenException(
          'Protected accounts can only be modified by a super administrator',
        );
      }
      if (!currentOwner && userGuid === actorGuid) {
        throw new ForbiddenException('You cannot modify your own roles');
      }
      const currentRolesForWrite = roleGuids.length
        ? await manager
            .getRepository(Role)
            .find({ where: { guid: In(roleGuids) } })
        : [];
      if (currentRolesForWrite.length !== roleGuids.length) {
        const found = new Set(currentRolesForWrite.map((role) => role.guid));
        throw new NotFoundException(
          `Role not found: ${roleGuids.filter((roleGuid) => !found.has(roleGuid)).join(', ')}`,
        );
      }
      if (!currentOwner) {
        const assignedProtectedRole = currentRolesForWrite.find(
          (role) => role.protectedAccount === true,
        );
        if (assignedProtectedRole) {
          throw new ForbiddenException(
            `Protected roles can only be assigned by a super administrator: ${assignedProtectedRole.guid}`,
          );
        }
      }
      const currentPermissionRowsForWrite = roleGuids.length
        ? await manager
            .getRepository(RolePermission)
            .find({ where: { roleGuid: In(roleGuids) } })
        : [];
      const permissionsForWrite = this.groupPermissions(
        currentPermissionRowsForWrite,
      );
      if (
        !currentOwner &&
        [...permissionsForWrite.values()].some((permissions) =>
          permissions.includes('roles.assign'),
        )
      ) {
        throw new ForbiddenException(
          'Roles containing roles.assign can only be assigned by a super administrator',
        );
      }
      for (const assignment of normalized) {
        const permissions = permissionsForWrite.get(assignment.role_guid) || [];
        if (
          assignment.scope_type === 'device_group' &&
          (permissions.length === 0 ||
            permissions.some(
              (permission) => !isDeviceGroupScopedPermission(permission),
            ))
        ) {
          throw new BadRequestException(
            'device_group scope only supports device actions and strategies.assign',
          );
        }
      }
      if (groupGuids.length) {
        const currentGroups = await manager
          .getRepository(DeviceGroup)
          .find({ where: { guid: In(groupGuids) }, select: ['guid'] });
        if (currentGroups.length !== groupGuids.length) {
          const found = new Set(currentGroups.map((group) => group.guid));
          throw new BadRequestException(
            `Device group not found: ${groupGuids.filter((groupGuid) => !found.has(groupGuid)).join(', ')}`,
          );
        }
      }
      const before = await this.getUserRoles(userGuid, manager);
      const current = await manager.getRepository(UserRoleAssignment).find({
        where: { userGuid },
        select: ['guid', 'roleGuid', 'scopeType'],
      });
      if (!currentOwner) {
        const currentRoleGuids = new Set(
          current.map((assignment) => assignment.roleGuid),
        );
        const currentRoles = currentRoleGuids.size
          ? await manager
              .getRepository(Role)
              .find({ where: { guid: In([...currentRoleGuids]) } })
          : [];
        const currentPermissionRows = currentRoleGuids.size
          ? await manager
              .getRepository(RolePermission)
              .find({ where: { roleGuid: In([...currentRoleGuids]) } })
          : [];
        const currentPermissions = this.groupPermissions(currentPermissionRows);
        const lockedRoleGuids = new Set(
          currentRoles
            .filter((role) => role.protectedAccount)
            .map((role) => role.guid),
        );
        for (const [roleGuid, permissions] of currentPermissions) {
          if (permissions.includes('roles.assign'))
            lockedRoleGuids.add(roleGuid);
        }
        const omitted = current.find(
          (assignment) =>
            !requestedRoleGuids.has(assignment.roleGuid) &&
            lockedRoleGuids.has(assignment.roleGuid),
        );
        if (omitted)
          throw new ForbiddenException(
            `Cannot remove protected role: ${omitted.roleGuid}`,
          );
        const finalRoleRows = roleGuids.length
          ? await manager
              .getRepository(RolePermission)
              .find({ where: { roleGuid: In(roleGuids) } })
          : [];
        const finalPermissions = this.groupPermissions(finalRoleRows);
        const caller = await this.authorizationService.getEffectivePermissions(
          actorGuid,
          manager,
        );
        const proposed = new Map<
          PermissionCode,
          { global: boolean; groups: Set<string> }
        >();
        for (const assignment of normalized) {
          for (const permission of finalPermissions.get(assignment.role_guid) ||
            []) {
            const grant = proposed.get(permission) || {
              global: false,
              groups: new Set<string>(),
            };
            if (assignment.scope_type === 'global') grant.global = true;
            else
              for (const group of assignment.device_group_guids || [])
                grant.groups.add(group);
            proposed.set(permission, grant);
          }
        }
        for (const [permission, grant] of proposed) {
          const allowed = caller.scopes[permission];
          if (
            !allowed ||
            (grant.global && allowed.scope_type !== 'global') ||
            (!grant.global &&
              allowed.scope_type === 'device_group' &&
              ![...grant.groups].every((group) =>
                allowed.device_group_guids.includes(group),
              ))
          ) {
            throw new ForbiddenException(
              `Role permissions exceed the operator scope: ${permission}`,
            );
          }
        }
      }
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

  private async loadAssignments(
    userGuid: string,
    manager?: import('typeorm').EntityManager,
  ) {
    const assignmentRepository =
      manager?.getRepository(UserRoleAssignment) ?? this.assignmentRepository;
    const assignments = await assignmentRepository.find({
      where: { userGuid },
      order: { createdAt: 'ASC' },
    });
    if (!assignments.length) return [];
    const roleGuids = [
      ...new Set(assignments.map((assignment) => assignment.roleGuid)),
    ];
    const assignmentGuids = assignments.map((assignment) => assignment.guid);
    const [roles, permissions, groups] = await Promise.all([
      (manager?.getRepository(Role) ?? this.roleRepository).find({
        where: { guid: In(roleGuids) },
      }),
      (
        manager?.getRepository(RolePermission) ?? this.rolePermissionRepository
      ).find({
        where: { roleGuid: In(roleGuids) },
      }),
      (
        manager?.getRepository(UserRoleAssignmentDeviceGroup) ??
        this.assignmentGroupRepository
      ).find({
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
                isDeviceGroupScopedPermission(permission),
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
        if (!isAssignablePermissionCode(permission)) continue;
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
        throw new BadRequestException(
          'The same user cannot be assigned duplicate roles',
        );
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
    const codesByRole = new Map<string, string[]>();
    for (const row of rows) {
      // Damaged/legacy rows must never appear as effective permissions or be
      // echoed back as if they were part of the code-owned catalog.
      if (!isAssignablePermissionCode(row.permissionCode)) continue;
      const list = codesByRole.get(row.roleGuid) || [];
      list.push(row.permissionCode);
      codesByRole.set(row.roleGuid, list);
    }
    return new Map(
      [...codesByRole].map(([roleGuid, codes]) => [
        roleGuid,
        filterEffectivePermissionCodes(codes),
      ]),
    );
  }

  private async ensureUserExists(
    manager: import('typeorm').EntityManager | undefined,
    userGuid: string,
  ) {
    if (
      !(await (manager?.getRepository(User) ?? this.userRepository).exist({
        where: { guid: userGuid },
      }))
    ) {
      throw new NotFoundException('User does not exist');
    }
  }
}
