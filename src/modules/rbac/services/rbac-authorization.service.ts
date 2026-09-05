import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Peer } from '../../../common/entities/peer.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { DeviceGroup } from '../../device-group/entities/device-group.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserRoleAssignment } from '../entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from '../entities/user-role-assignment-device-group.entity';
import {
  DEVICE_SCOPED_PERMISSION_CODES,
  isKnownPermissionCode,
  PERMISSION_CATALOG,
  PermissionCode,
} from '../constants/permission-catalog';
import { RbacAuditService } from './rbac-audit.service';

export interface EffectivePermissionScope {
  scope_type: 'global' | 'device_group' | 'none';
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
  ) {}

  async getCurrentUser(userGuid: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { guid: userGuid },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('账户不存在或已被禁用');
    }
    return user;
  }

  async requireSuperAdmin(userGuid: string): Promise<User> {
    const user = await this.getCurrentUser(userGuid);
    if (!user.isAdmin) {
      throw new ForbiddenException('需要超级管理员权限');
    }
    return user;
  }

  async getPermissionScope(
    userGuid: string,
    permissionCode: string,
  ): Promise<PermissionScope> {
    const user = await this.getCurrentUser(userGuid);
    if (user.isAdmin || !isKnownPermissionCode(permissionCode)) {
      return {
        global: user.isAdmin === true,
        deviceGroupGuids: new Set<string>(),
      };
    }

    const allAssignments = await this.assignmentRepository.find({
      where: { userGuid },
      select: ['guid', 'roleGuid', 'scopeType'],
    });
    const assignments = allAssignments.length
      ? allAssignments.filter(
          (assignment) =>
            assignment.scopeType === 'global' ||
            assignment.scopeType === 'device_group',
        )
      : [];
    const rolePermissions = assignments.length
      ? await this.rolePermissionRepository.find({
          where: {
            roleGuid: In(assignments.map((assignment) => assignment.roleGuid)),
            permissionCode,
          },
        })
      : [];
    const matchingRoleGuids = new Set(
      rolePermissions.map((permission) => permission.roleGuid),
    );
    const matchingAssignments = assignments.filter(
      (assignment) =>
        matchingRoleGuids.has(assignment.roleGuid) &&
        (assignment.scopeType === 'global' ||
          DEVICE_SCOPED_PERMISSION_CODES.has(permissionCode)),
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

    const groups = await this.assignmentGroupRepository.find({
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
  ): Promise<PermissionScope> {
    if (!isKnownPermissionCode(permissionCode)) {
      throw new ForbiddenException('未知权限');
    }
    const scope = await this.getPermissionScope(userGuid, permissionCode);
    if (!scope.global && scope.deviceGroupGuids.size === 0) {
      throw new ForbiddenException('无权限访问');
    }
    return scope;
  }

  async getEffectivePermissions(userGuid: string): Promise<{
    permissions: string[];
    scopes: Record<string, EffectivePermissionScope>;
  }> {
    const user = await this.getCurrentUser(userGuid);
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

    const assignments = await this.assignmentRepository.find({
      where: { userGuid },
      select: ['guid', 'roleGuid', 'scopeType'],
    });
    const rows = assignments.length
      ? await this.rolePermissionRepository.find({
          where: {
            roleGuid: In(assignments.map((assignment) => assignment.roleGuid)),
          },
        })
      : [];
    const permissions = new Set<string>();
    const assignmentIds = new Set<string>();
    const scopeRows = new Map<string, { global: boolean; ids: Set<string> }>();
    const assignmentByRole = new Map(
      assignments.map((assignment) => [assignment.roleGuid, assignment]),
    );
    const permissionAssignmentRows: Array<{
      assignmentGuid: string;
      scopeType: 'global' | 'device_group';
      permissionCode: string;
    }> = [];
    for (const row of rows) {
      if (!isKnownPermissionCode(row.permissionCode)) continue;
      const assignment = assignmentByRole.get(row.roleGuid);
      if (!assignment) continue;
      if (
        assignment.scopeType !== 'global' &&
        assignment.scopeType !== 'device_group'
      ) {
        continue;
      }
      if (
        assignment.scopeType === 'device_group' &&
        !DEVICE_SCOPED_PERMISSION_CODES.has(row.permissionCode)
      ) {
        continue;
      }
      permissions.add(row.permissionCode);
      assignmentIds.add(assignment.guid);
      permissionAssignmentRows.push({
        assignmentGuid: assignment.guid,
        scopeType: assignment.scopeType,
        permissionCode: row.permissionCode,
      });
      const current = scopeRows.get(row.permissionCode) || {
        global: false,
        ids: new Set<string>(),
      };
      if (assignment.scopeType === 'global') current.global = true;
      scopeRows.set(row.permissionCode, current);
    }
    if (assignmentIds.size) {
      const groups = await this.assignmentGroupRepository.find({
        where: { assignmentGuid: In([...assignmentIds]) },
        select: ['assignmentGuid', 'deviceGroupGuid'],
      });
      const assignmentPermission = new Map<string, string[]>();
      for (const row of permissionAssignmentRows) {
        const list = assignmentPermission.get(row.assignmentGuid) || [];
        list.push(row.permissionCode);
        assignmentPermission.set(row.assignmentGuid, list);
      }
      for (const group of groups) {
        for (const permission of assignmentPermission.get(
          group.assignmentGuid,
        ) || []) {
          scopeRows.get(permission)?.ids.add(group.deviceGroupGuid);
        }
      }
    }
    const scopes: Record<string, EffectivePermissionScope> = {};
    for (const [permission, scope] of scopeRows) {
      scopes[permission] = scope.global
        ? { scope_type: 'global', device_group_guids: [] }
        : {
            scope_type: 'device_group',
            device_group_guids: [...scope.ids].sort(),
          };
    }
    return { permissions: [...permissions].sort(), scopes };
  }

  async assertDeviceAccess(
    userGuid: string,
    permissionCode: PermissionCode,
    deviceUuid: string,
  ): Promise<Peer> {
    const scope = await this.requirePermission(userGuid, permissionCode);
    const peer = await this.peerRepository.findOne({
      where: { uuid: deviceUuid },
    });
    if (!peer) throw new NotFoundException('设备不存在');
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
        new ForbiddenException('设备不在授权设备组内'),
      );
    }
    return peer;
  }

  async assertDevicesAccess(
    userGuid: string,
    permissionCode: PermissionCode,
    deviceUuids: string[],
  ): Promise<Peer[]> {
    const scope = await this.requirePermission(userGuid, permissionCode);
    const unique = [...new Set(deviceUuids)];
    if (!unique.length) return [];
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
          new ForbiddenException('批量请求包含未授权设备'),
        );
      }
    }
    return peers;
  }

  async assertStrategyTargets(
    userGuid: string,
    targetType: 'device' | 'user' | 'device_group',
    targetGuids: string[],
  ): Promise<void> {
    const scope = await this.requirePermission(userGuid, 'strategies.assign');
    if (targetType === 'user') {
      if (!scope.global) {
        return this.rejectWithAudit(
          userGuid,
          'user',
          targetGuids[0] || null,
          'strategies.assign',
          new ForbiddenException('按用户分配策略需要全局权限'),
        );
      }
      const users = await this.userRepository.find({
        where: { guid: In([...new Set(targetGuids)]) },
        select: ['guid', 'isAdmin'],
      });
      const protectedUser = users.find((user) => user.isAdmin);
      if (protectedUser) {
        try {
          await this.requireSuperAdmin(userGuid);
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
      return;
    }
    if (scope.global) return;
    if (targetType === 'device_group') {
      const requested = [...new Set(targetGuids)];
      const groups = await this.deviceGroupRepository.find({
        where: { guid: In(requested) },
        select: ['guid'],
      });
      const selected = new Set(scope.deviceGroupGuids);
      const existing = new Set(groups.map((group) => group.guid));
      const deniedGuid = requested.find(
        (guid) => !existing.has(guid) || !selected.has(guid),
      );
      if (deniedGuid) {
        return this.rejectWithAudit(
          userGuid,
          'device_group',
          deniedGuid,
          'strategies.assign',
          new ForbiddenException('目标设备组不在授权范围内'),
        );
      }
      return;
    }
    const peers = await this.peerRepository.find({
      where: { uuid: In([...new Set(targetGuids)]) },
      select: ['uuid', 'deviceGroupGuid'],
    });
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
        new ForbiddenException('目标设备不在授权设备组内'),
      );
    }
  }

  async assertUserMutation(
    actorGuid: string,
    targetGuid: string,
    permissionCode: PermissionCode,
    changes?: {
      is_admin?: boolean;
      status?: unknown;
      user_group_guid?: unknown;
    },
  ): Promise<void> {
    await this.requirePermission(actorGuid, permissionCode);

    // The legacy user update endpoint accepts several fields. Keep each
    // sensitive field behind its own action so `users.edit` cannot silently
    // become a status or group-membership grant.
    if (changes?.status !== undefined && permissionCode !== 'users.status') {
      try {
        await this.requirePermission(actorGuid, 'users.status');
      } catch (error: unknown) {
        return this.rejectWithAudit(
          actorGuid,
          'user',
          targetGuid,
          'users.status',
          error,
        );
      }
    }
    if (
      changes?.user_group_guid !== undefined &&
      permissionCode !== 'user_groups.membership'
    ) {
      try {
        await this.requirePermission(actorGuid, 'user_groups.membership');
      } catch (error: unknown) {
        return this.rejectWithAudit(
          actorGuid,
          'user',
          targetGuid,
          'user_groups.membership',
          error,
        );
      }
    }

    const target = await this.userRepository.findOne({
      where: { guid: targetGuid },
      select: ['guid', 'isAdmin'],
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (target.isAdmin || changes?.is_admin !== undefined) {
      try {
        await this.requireSuperAdmin(actorGuid);
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
   * Missing identifiers are intentionally ignored here so existing partial
   * batch responses can report them after all existing targets are checked.
   */
  async assertUsersMutation(
    actorGuid: string,
    targetGuids: string[],
    permissionCode: PermissionCode,
  ): Promise<void> {
    await this.requirePermission(actorGuid, permissionCode);
    const uniqueGuids = [...new Set(targetGuids)];
    if (!uniqueGuids.length) return;

    const users = await this.userRepository.find({
      where: { guid: In(uniqueGuids) },
      select: ['guid', 'isAdmin'],
    });
    const protectedUser = users.find((user) => user.isAdmin);
    if (protectedUser) {
      try {
        await this.requireSuperAdmin(actorGuid);
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
