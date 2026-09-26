import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Peer } from '../../../common/entities/peer.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { DeviceGroup } from '../../device-group/entities/device-group.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Role } from '../entities/role.entity';
import { UserRoleAssignment } from '../entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from '../entities/user-role-assignment-device-group.entity';
import {
  filterEffectivePermissionCodes,
  isDeviceGroupScopedPermission,
  isAssignablePermissionCode,
  PERMISSION_CATALOG,
  PermissionCode,
} from '../constants/permission-catalog';
import { RbacAuditService } from './rbac-audit.service';

export interface EffectivePermissionScope {
  scope_type: 'global' | 'device_group';
  device_group_guids: string[];
}

export interface PermissionScope {
  global: boolean;
  deviceGroupGuids: Set<string>;
}

@Injectable()
export class RbacAuthorizationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRoleAssignment)
    private readonly assignmentRepository: Repository<UserRoleAssignment>,
    @InjectRepository(UserRoleAssignmentDeviceGroup)
    private readonly assignmentGroupRepository: Repository<UserRoleAssignmentDeviceGroup>,
    @InjectRepository(Peer)
    private readonly peerRepository: Repository<Peer>,
    @InjectRepository(DeviceGroup)
    private readonly deviceGroupRepository: Repository<DeviceGroup>,
    private readonly auditService: RbacAuditService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async getCurrentUser(
    userGuid: string,
    manager?: EntityManager,
  ): Promise<User> {
    const user = await (
      manager?.getRepository(User) ?? this.userRepository
    ).findOne({
      where: { guid: userGuid },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        'Account does not exist or has been disabled',
      );
    }
    return user;
  }

  async requireSuperAdmin(
    userGuid: string,
    manager?: EntityManager,
  ): Promise<User> {
    const user = await this.getCurrentUser(userGuid, manager);
    if (!user.isAdmin) {
      throw new ForbiddenException('Super administrator permission required');
    }
    return user;
  }

  async getPermissionScope(
    userGuid: string,
    permissionCode: string,
    manager?: EntityManager,
  ): Promise<PermissionScope> {
    const user = await this.getCurrentUser(userGuid, manager);
    if (user.isAdmin || !isAssignablePermissionCode(permissionCode)) {
      return {
        global: user.isAdmin === true,
        deviceGroupGuids: new Set<string>(),
      };
    }

    const { assignments, effectivePermissionsByRole } =
      await this.loadEffectiveRoleGrants(userGuid, manager);
    const matchingAssignments = assignments.filter(
      (assignment) =>
        effectivePermissionsByRole
          .get(assignment.roleGuid)
          ?.has(permissionCode) &&
        (assignment.scopeType === 'global' ||
          isDeviceGroupScopedPermission(permissionCode)),
    );

    const global = matchingAssignments.some(
      (assignment) => assignment.scopeType === 'global',
    );
    if (global) {
      return { global: true, deviceGroupGuids: new Set<string>() };
    }

    const scopedAssignments = matchingAssignments.filter(
      (assignment) => assignment.scopeType === 'device_group',
    );
    if (!scopedAssignments.length) {
      return { global: false, deviceGroupGuids: new Set<string>() };
    }

    const groups = await (
      manager?.getRepository(UserRoleAssignmentDeviceGroup) ??
      this.assignmentGroupRepository
    ).find({
      where: {
        assignmentGuid: In(
          scopedAssignments.map((assignment) => assignment.guid),
        ),
      },
      select: ['deviceGroupGuid'],
    });

    return {
      global: false,
      deviceGroupGuids: new Set(groups.map((group) => group.deviceGroupGuid)),
    };
  }

  async requirePermission(
    userGuid: string,
    permissionCode: string,
    manager?: EntityManager,
  ): Promise<PermissionScope> {
    if (!isAssignablePermissionCode(permissionCode)) {
      throw new ForbiddenException('Unknown permission');
    }
    const scope = await this.getPermissionScope(
      userGuid,
      permissionCode,
      manager,
    );
    if (!scope.global && scope.deviceGroupGuids.size === 0) {
      throw new ForbiddenException('Access denied');
    }
    return scope;
  }

  async getEffectivePermissions(
    userGuid: string,
    manager?: EntityManager,
  ): Promise<{
    permissions: string[];
    scopes: Record<string, EffectivePermissionScope>;
  }> {
    const user = await this.getCurrentUser(userGuid, manager);
    if (user.isAdmin) {
      const scopes = Object.fromEntries(
        PERMISSION_CATALOG.map((permission) => [
          permission.code,
          { scope_type: 'global', device_group_guids: [] },
        ]),
      ) as Record<string, EffectivePermissionScope>;
      return {
        permissions: PERMISSION_CATALOG.map((permission) => permission.code),
        scopes,
      };
    }

    const { assignments, effectivePermissionsByRole } =
      await this.loadEffectiveRoleGrants(userGuid, manager);
    const scopeRows = new Map<
      PermissionCode,
      { global: boolean; ids: Set<string> }
    >();
    const scopedPermissionsByAssignment = new Map<string, PermissionCode[]>();
    for (const assignment of assignments) {
      for (const permissionCode of effectivePermissionsByRole.get(
        assignment.roleGuid,
      ) || []) {
        if (
          assignment.scopeType === 'device_group' &&
          !isDeviceGroupScopedPermission(permissionCode)
        ) {
          continue;
        }
        const current = scopeRows.get(permissionCode) || {
          global: false,
          ids: new Set<string>(),
        };
        if (assignment.scopeType === 'global') {
          current.global = true;
        } else {
          const scopedPermissions =
            scopedPermissionsByAssignment.get(assignment.guid) || [];
          scopedPermissions.push(permissionCode);
          scopedPermissionsByAssignment.set(assignment.guid, scopedPermissions);
        }
        scopeRows.set(permissionCode, current);
      }
    }
    if (scopedPermissionsByAssignment.size) {
      const groups = await (
        manager?.getRepository(UserRoleAssignmentDeviceGroup) ??
        this.assignmentGroupRepository
      ).find({
        where: {
          assignmentGuid: In([...scopedPermissionsByAssignment.keys()]),
        },
        select: ['assignmentGuid', 'deviceGroupGuid'],
      });
      for (const group of groups) {
        for (const permission of scopedPermissionsByAssignment.get(
          group.assignmentGuid,
        ) || []) {
          scopeRows.get(permission)?.ids.add(group.deviceGroupGuid);
        }
      }
    }
    const scopes: Record<string, EffectivePermissionScope> = {};
    for (const [permission, scope] of scopeRows) {
      if (!scope.global && scope.ids.size === 0) continue;
      scopes[permission] = scope.global
        ? { scope_type: 'global', device_group_guids: [] }
        : {
            scope_type: 'device_group',
            device_group_guids: [...scope.ids].sort(),
          };
    }
    return { permissions: Object.keys(scopes).sort(), scopes };
  }

  private async loadEffectiveRoleGrants(
    userGuid: string,
    manager?: EntityManager,
  ): Promise<{
    assignments: UserRoleAssignment[];
    effectivePermissionsByRole: Map<string, Set<PermissionCode>>;
  }> {
    const assignments = (
      await (
        manager?.getRepository(UserRoleAssignment) ?? this.assignmentRepository
      ).find({
        where: { userGuid },
        select: ['guid', 'roleGuid', 'scopeType'],
      })
    ).filter(
      (assignment) =>
        assignment.scopeType === 'global' ||
        assignment.scopeType === 'device_group',
    );
    const rows = assignments.length
      ? await (
          manager?.getRepository(RolePermission) ??
          this.rolePermissionRepository
        ).find({
          where: {
            roleGuid: In(assignments.map((assignment) => assignment.roleGuid)),
          },
        })
      : [];
    const permissionCodesByRole = new Map<string, string[]>();
    for (const row of rows) {
      const codes = permissionCodesByRole.get(row.roleGuid) || [];
      codes.push(row.permissionCode);
      permissionCodesByRole.set(row.roleGuid, codes);
    }
    return {
      assignments,
      effectivePermissionsByRole: new Map(
        [...permissionCodesByRole].map(([roleGuid, codes]) => [
          roleGuid,
          new Set(filterEffectivePermissionCodes(codes)),
        ]),
      ),
    };
  }

  async assertDeviceAccess(
    userGuid: string,
    permissionCode: PermissionCode,
    deviceUuid: string,
  ): Promise<{ peer: Peer; scope: PermissionScope }> {
    const scope = await this.requirePermission(userGuid, permissionCode);
    const peer = await this.peerRepository.findOne({
      where: { uuid: deviceUuid },
    });
    if (!peer) throw new NotFoundException('Device not found');
    if (
      !scope.global &&
      (!peer.deviceGroupGuid ||
        !scope.deviceGroupGuids.has(peer.deviceGroupGuid))
    ) {
      return this.rejectWithAudit(
        userGuid,
        'device',
        deviceUuid,
        permissionCode,
        new ForbiddenException('Device is not in an authorized device group'),
      );
    }
    return { peer, scope };
  }

  async assertDevicesAccess(
    userGuid: string,
    permissionCode: PermissionCode,
    deviceUuids: string[],
  ): Promise<{ peers: Peer[]; scope: PermissionScope }> {
    const scope = await this.requirePermission(userGuid, permissionCode);
    const unique = [...new Set(deviceUuids)];
    if (!unique.length) return { peers: [], scope };
    const peers = await this.peerRepository.find({
      where: { uuid: In(unique) },
    });
    if (!scope.global) {
      const denied = peers.find(
        (peer) =>
          !peer.deviceGroupGuid ||
          !scope.deviceGroupGuids.has(peer.deviceGroupGuid),
      );
      if (denied) {
        return this.rejectWithAudit(
          userGuid,
          'device',
          denied.uuid,
          permissionCode,
          new ForbiddenException('Batch request contains unauthorized devices'),
        );
      }
    }
    return { peers, scope };
  }

  async assertStrategyTargets(
    userGuid: string,
    targetType: 'device' | 'user' | 'device_group',
    targetGuids: string[],
    manager?: EntityManager,
  ): Promise<PermissionScope> {
    const scope = await this.requirePermission(
      userGuid,
      'strategies.assign',
      manager,
    );
    if (targetType === 'user') {
      if (!scope.global) {
        return this.rejectWithAudit(
          userGuid,
          'user',
          targetGuids[0] || null,
          'strategies.assign',
          new ForbiddenException(
            'Assigning strategies by user requires global permission',
          ),
        );
      }
      const users = await (
        manager?.getRepository(User) ?? this.userRepository
      ).find({
        where: { guid: In([...new Set(targetGuids)]) },
        select: ['guid', 'isAdmin'],
      });
      if (users.length !== new Set(targetGuids).size) {
        throw new NotFoundException('User does not exist');
      }
      const protectedUsers = await this.getProtectedUserGuids(
        users.map((user) => user.guid),
        users.filter((user) => user.isAdmin).map((user) => user.guid),
        manager,
      );
      const protectedUser = users.find((user) => protectedUsers.has(user.guid));
      if (protectedUser) {
        try {
          await this.requireSuperAdmin(userGuid, manager);
        } catch (error: unknown) {
          return this.rejectWithAudit(
            userGuid,
            'user',
            protectedUser.guid,
            'super_admin',
            error,
          );
        }
      }
      return scope;
    }
    if (targetType === 'device_group') {
      const requested = [...new Set(targetGuids)];
      const groups = await (
        manager?.getRepository(DeviceGroup) ?? this.deviceGroupRepository
      ).find({
        where: { guid: In(requested) },
        select: ['guid'],
      });
      if (scope.global) return scope;
      const selected = new Set(scope.deviceGroupGuids);
      const deniedGuid = groups.find(
        (group) => !selected.has(group.guid),
      )?.guid;
      if (deniedGuid) {
        return this.rejectWithAudit(
          userGuid,
          'device_group',
          deniedGuid,
          'strategies.assign',
          new ForbiddenException(
            'Target device group is outside the authorized scope',
          ),
        );
      }
      return scope;
    }
    const peers = await (
      manager?.getRepository(Peer) ?? this.peerRepository
    ).find({
      where: { uuid: In([...new Set(targetGuids)]) },
      select: ['uuid', 'deviceGroupGuid'],
    });
    if (scope.global) return scope;
    const denied = peers.find(
      (peer) =>
        !peer.deviceGroupGuid ||
        !scope.deviceGroupGuids.has(peer.deviceGroupGuid),
    );
    if (denied) {
      return this.rejectWithAudit(
        userGuid,
        'device',
        denied.uuid,
        'strategies.assign',
        new ForbiddenException(
          'Target device is not in an authorized device group',
        ),
      );
    }
    return scope;
  }

  async assertUserMutation(
    actorGuid: string,
    targetGuid: string,
    permissionCode: PermissionCode,
    _changes?: {
      is_admin?: boolean;
    },
    manager?: EntityManager,
  ): Promise<void> {
    await this.requirePermission(actorGuid, permissionCode, manager);

    const target = await (
      manager?.getRepository(User) ?? this.userRepository
    ).findOne({
      where: { guid: targetGuid },
      select: ['guid', 'isAdmin'],
    });
    if (!target) throw new NotFoundException('User does not exist');
    if (await this.isProtectedUser(targetGuid, target.isAdmin, manager)) {
      try {
        await this.requireSuperAdmin(actorGuid, manager);
      } catch (error: unknown) {
        return this.rejectWithAudit(
          actorGuid,
          'user',
          targetGuid,
          'super_admin',
          error,
        );
      }
    }
  }

  /**
   * Pre-authorize a user batch before the owning service performs any write.
   * The owning service remains responsible for its missing-target contract
   * and for making the write atomic when it promises all-or-nothing behavior.
   */
  async assertUsersMutation(
    actorGuid: string,
    targetGuids: string[],
    permissionCode: PermissionCode,
    manager?: EntityManager,
  ): Promise<void> {
    await this.requirePermission(actorGuid, permissionCode, manager);
    const uniqueGuids = [...new Set(targetGuids)];
    if (!uniqueGuids.length) return;

    const users = await (
      manager?.getRepository(User) ?? this.userRepository
    ).find({
      where: { guid: In(uniqueGuids) },
      select: ['guid', 'isAdmin'],
    });
    const protectedGuids = await this.getProtectedUserGuids(
      users.map((user) => user.guid),
      users.filter((user) => user.isAdmin).map((user) => user.guid),
      manager,
    );
    const protectedUser = users.find((user) => protectedGuids.has(user.guid));
    if (protectedUser) {
      try {
        await this.requireSuperAdmin(actorGuid, manager);
      } catch (error: unknown) {
        return this.rejectWithAudit(
          actorGuid,
          'user',
          protectedUser.guid,
          'super_admin',
          error,
        );
      }
    }
  }

  async isProtectedUser(
    userGuid: string,
    isAdmin?: boolean,
    manager?: EntityManager,
  ): Promise<boolean> {
    const user = manager
      ? await manager.getRepository(User).findOne({
          where: { guid: userGuid },
          select: ['guid', 'isAdmin'],
        })
      : undefined;
    if (user?.isAdmin === true || (!manager && isAdmin === true)) return true;
    const assignments = await (
      manager?.getRepository(UserRoleAssignment) ?? this.assignmentRepository
    ).find({
      where: { userGuid },
      select: ['roleGuid'],
    });
    if (!assignments.length) return false;
    return (
      await (manager?.getRepository(Role) ?? this.roleRepository).find({
        where: { guid: In([...new Set(assignments.map((a) => a.roleGuid))]) },
        select: ['guid', 'protectedAccount'],
      })
    ).some((role) => role.protectedAccount === true);
  }

  /** Bulk protection projection used by administrative list endpoints. */
  async getEffectiveProtectionMap(
    userGuids: string[],
    manager?: EntityManager,
  ): Promise<Map<string, boolean>> {
    const unique = [...new Set(userGuids)];
    const result = new Map(unique.map((guid) => [guid, false]));
    if (!unique.length) return result;
    const users = await (
      manager?.getRepository(User) ?? this.userRepository
    ).find({
      where: { guid: In(unique) },
      select: ['guid', 'isAdmin'],
    });
    for (const user of users) if (user.isAdmin) result.set(user.guid, true);
    const assignments = await (
      manager?.getRepository(UserRoleAssignment) ?? this.assignmentRepository
    ).find({
      where: { userGuid: In(unique) },
      select: ['userGuid', 'roleGuid'],
    });
    if (!assignments.length) return result;
    const roles = await (
      manager?.getRepository(Role) ?? this.roleRepository
    ).find({
      where: {
        guid: In([
          ...new Set(assignments.map((assignment) => assignment.roleGuid)),
        ]),
        protectedAccount: true,
      },
      select: ['guid'],
    });
    const protectedRoles = new Set(roles.map((role) => role.guid));
    for (const assignment of assignments) {
      if (protectedRoles.has(assignment.roleGuid))
        result.set(assignment.userGuid, true);
    }
    return result;
  }

  private async getProtectedUserGuids(
    userGuids: string[],
    knownOwners: string[],
    manager?: EntityManager,
  ): Promise<Set<string>> {
    const result = await this.getEffectiveProtectionMap(userGuids, manager);
    for (const guid of knownOwners) result.set(guid, true);
    return new Set(
      [...result]
        .filter(([, protectedUser]) => protectedUser)
        .map(([guid]) => guid),
    );
  }

  private async rejectWithAudit(
    actorUserGuid: string,
    targetType: string,
    targetGuid: string | null,
    action: string,
    error: unknown,
  ): Promise<never> {
    await this.auditService.recordDenied({
      actorUserGuid,
      targetType,
      targetGuid,
      action,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
