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
  DEVICE_SCOPED_PERMISSION_CODES,
  PermissionCode,
  isKnownPermissionCode,
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
    if (query.search) {
      builder.andWhere('role.name LIKE :search', {
        search: `%${query.search}%`,
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
    const permissions = await this.rolePermissionRepository.find({
      where: { roleGuid: guid },
    });
    return this.toResponse(
      role,
      permissions
        .map((permission) => permission.permissionCode)
        .filter(isKnownPermissionCode)
        .sort(),
    );
  }

  async createRole(dto: CreateRoleDto, actorGuid: string) {
    await this.authorizationService.requireSuperAdmin(actorGuid);
    const name = this.normalizeName(dto.name);
    const permissions = this.validatePermissions(dto.permissions);
    await this.ensureNameAvailable(name);
    return this.dataSource.transaction(async (manager) => {
      const role = manager.getRepository(Role).create({
        guid: uuidv4(),
        name,
        note: dto.note?.trim() || null,
      });
      try {
        await manager.getRepository(Role).save(role);
      } catch (error: unknown) {
        if (this.isUniqueError(error))
          throw new ConflictException('角色名称已存在');
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
          afterState: { name: role.name, note: role.note, permissions },
        },
        manager,
      );
      return this.toResponse(role, permissions);
    });
  }

  async updateRole(guid: string, dto: UpdateRoleDto, actorGuid: string) {
    await this.authorizationService.requireSuperAdmin(actorGuid);
    const role = await this.requireRole(guid);
    const beforePermissions = await this.getPermissionCodes(guid);
    const beforeName = role.name;
    const beforeNote = role.note;
    const name =
      dto.name === undefined ? role.name : this.normalizeName(dto.name);
    if (name !== role.name) await this.ensureNameAvailable(name, guid);
    const permissions =
      dto.permissions === undefined
        ? beforePermissions
        : this.validatePermissions(dto.permissions);
    if (dto.permissions !== undefined) {
      await this.ensureScopedAssignmentsRemainValid(guid, permissions);
    }
    return this.dataSource.transaction(async (manager) => {
      role.name = name;
      if (dto.note !== undefined) role.note = dto.note.trim() || null;
      await manager.getRepository(Role).save(role);
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
          },
          afterState: { name: role.name, note: role.note, permissions },
        },
        manager,
      );
      return this.toResponse(role, permissions);
    });
  }

  async deleteRole(guid: string, actorGuid: string): Promise<void> {
    await this.authorizationService.requireSuperAdmin(actorGuid);
    const role = await this.requireRole(guid);
    const assignments = await this.assignmentRepository.find({
      where: { roleGuid: guid },
      select: ['guid'],
    });
    await this.dataSource.transaction(async (manager) => {
      if (assignments.length) {
        await manager.delete(UserRoleAssignmentDeviceGroup, {
          assignmentGuid: In(assignments.map((assignment) => assignment.guid)),
        });
        await manager.delete(UserRoleAssignment, { roleGuid: guid });
      }
      await manager.delete(RolePermission, { roleGuid: guid });
      await manager.delete(Role, { guid });
      await this.auditService.record(
        {
          actorUserGuid: actorGuid,
          targetType: 'role',
          targetGuid: guid,
          action: 'role.delete',
          result: 'allowed',
          beforeState: { name: role.name },
        },
        manager,
      );
    });
  }

  async replaceRolePermissions(
    guid: string,
    permissions: string[],
    actorGuid: string,
  ) {
    await this.authorizationService.requireSuperAdmin(actorGuid);
    await this.requireRole(guid);
    const validated = this.validatePermissions(permissions);
    await this.ensureScopedAssignmentsRemainValid(guid, validated);
    const before = await this.getPermissionCodes(guid);
    await this.dataSource.transaction(async (manager) => {
      await this.replacePermissionsWithManager(manager, guid, validated);
      await this.auditService.record(
        {
          actorUserGuid: actorGuid,
          targetType: 'role',
          targetGuid: guid,
          action: 'role.permissions.replace',
          result: 'allowed',
          beforeState: { permissions: before },
          afterState: { permissions: validated },
        },
        manager,
      );
    });
    return this.getRole(guid);
  }

  async getPermissionCodes(guid: string): Promise<PermissionCode[]> {
    await this.requireRole(guid);
    const rows = await this.rolePermissionRepository.find({
      where: { roleGuid: guid },
    });
    return rows
      .map((row) => row.permissionCode)
      .filter(isKnownPermissionCode)
      .sort();
  }

  private async requireRole(guid: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { guid } });
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  private normalizeName(value: string): string {
    const name = value.trim();
    if (!name) throw new BadRequestException('角色名称不能为空');
    return name;
  }

  private async ensureNameAvailable(name: string, ignoredGuid?: string) {
    const existing = await this.roleRepository
      .createQueryBuilder('role')
      .where('LOWER(role.name) = LOWER(:name)', { name })
      .getOne();
    if (existing && existing.guid !== ignoredGuid) {
      throw new ConflictException('角色名称已存在');
    }
  }

  private validatePermissions(permissions: string[]): PermissionCode[] {
    const unique = [...new Set(permissions)];
    const unknown = unique.filter(
      (permission) => !isKnownPermissionCode(permission),
    );
    if (unknown.length)
      throw new BadRequestException(`权限码不存在: ${unknown.join(', ')}`);
    return unique.filter(isKnownPermissionCode).sort();
  }

  private async ensureScopedAssignmentsRemainValid(
    roleGuid: string,
    permissions: PermissionCode[],
  ): Promise<void> {
    if (
      permissions.every((permission) =>
        DEVICE_SCOPED_PERMISSION_CODES.has(permission),
      )
    ) {
      return;
    }
    const hasScopedAssignment = await this.assignmentRepository.exist({
      where: { roleGuid, scopeType: 'device_group' },
    });
    if (hasScopedAssignment) {
      throw new BadRequestException(
        '已有高级范围授权的角色只能包含设备操作和 strategies.assign',
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
      if (isKnownPermissionCode(row.permissionCode))
        list.push(row.permissionCode);
      result.set(row.roleGuid, list.sort());
    }
    return result;
  }

  private toResponse(role: Role, permissions: string[]) {
    return {
      guid: role.guid,
      name: role.name,
      note: role.note || '',
      permissions,
      created_at: role.createdAt,
      updated_at: role.updatedAt,
    };
  }

  private isUniqueError(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      error.message.toUpperCase().includes('UNIQUE')
    );
  }
}
