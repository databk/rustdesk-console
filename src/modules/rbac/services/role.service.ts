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
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserRole } from '../entities/user-role.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import {
  CreateRoleDto,
  RoleQueryDto,
  UpdateRoleDto,
} from '../dto/role.dto';
import { BUILT_IN_ROLES } from '../constants/permission-catalog';

type RoleWithCounts = Role & { permissionCount?: number; userCount?: number };

/**
 * 角色服务
 *
 * 职责：
 * - 角色 CRUD（内置角色不可删除）
 * - 角色权限分配（整体替换，事务）
 * - 内置角色启动同步（每次启动重写权限映射，不触发会话失效）
 */
@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @InjectRepository(UserToken)
    private readonly userTokenRepository: Repository<UserToken>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 分页查询角色列表（含权限数与用户数）
   */
  async listRoles(query: RoleQueryDto): Promise<{
    data: Record<string, unknown>[];
    total: number;
  }> {
    const { current = 1, pageSize = 20, search } = query;
    const qb = this.roleRepository.createQueryBuilder('role');

    if (search) {
      qb.andWhere('(role.name LIKE :s OR role.code LIKE :s)', {
        s: `%${search}%`,
      });
    }

    qb.loadRelationCountAndMap('role.permissionCount', 'role.rolePermissions')
      .loadRelationCountAndMap('role.userCount', 'role.userRoles')
      .orderBy('role.isBuiltIn', 'DESC')
      .addOrderBy('role.createdAt', 'ASC')
      .skip((current - 1) * pageSize)
      .take(pageSize);

    const [roles, total] = await qb.getManyAndCount();

    const data = (roles as RoleWithCounts[]).map((r) => ({
      guid: r.guid,
      name: r.name,
      code: r.code,
      description: r.description,
      is_built_in: r.isBuiltIn,
      permission_count: r.permissionCount ?? 0,
      user_count: r.userCount ?? 0,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));

    return { data, total };
  }

  async getRole(guid: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { guid } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }
    return role;
  }

  async createRole(dto: CreateRoleDto): Promise<Role> {
    const role = this.roleRepository.create({
      guid: uuidv4(),
      name: dto.name,
      code: dto.code,
      description: dto.description ?? null,
      isBuiltIn: false,
    });
    try {
      await this.roleRepository.save(role);
    } catch (e) {
      if (e instanceof QueryFailedError) {
        throw new ConflictException('角色名称或代码已存在');
      }
      throw e;
    }
    this.logger.log(`创建角色: ${dto.code}`);
    return role;
  }

  async updateRole(guid: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.getRole(guid);
    if (dto.name !== undefined) role.name = dto.name;
    if (dto.description !== undefined) role.description = dto.description;
    try {
      await this.roleRepository.save(role);
    } catch (e) {
      if (e instanceof QueryFailedError) {
        throw new ConflictException('角色名称已存在');
      }
      throw e;
    }
    return role;
  }

  /**
   * 删除角色
   * - 内置角色不可删除
   * - 被用户引用时不可删除（需先解绑）
   */
  async deleteRole(guid: string): Promise<void> {
    const role = await this.getRole(guid);
    if (role.isBuiltIn) {
      throw new ConflictException('内置角色不可删除');
    }
    const refCount = await this.userRoleRepository.count({
      where: { roleGuid: guid },
    });
    if (refCount > 0) {
      throw new ConflictException(
        `角色已被 ${refCount} 个用户引用，请先解绑后再删除`,
      );
    }
    await this.roleRepository.remove(role);
    this.logger.log(`删除角色: ${role.code}`);
  }

  /**
   * 获取角色已分配的权限码列表
   */
  async getRolePermissions(guid: string): Promise<string[]> {
    await this.getRole(guid);
    const rps = await this.rolePermissionRepository.find({
      where: { roleGuid: guid },
      relations: { permission: true },
    });
    return rps.map((rp) => rp.permission.code);
  }

  /**
   * 整体替换角色权限
   * 事务内删除旧映射并写入新映射；变更后失效该角色所有用户的会话。
   */
  async assignRolePermissions(
    guid: string,
    codes: string[],
  ): Promise<void> {
    await this.getRole(guid);
    const permissionGuids = await this.resolvePermissionGuidsByCodes(codes);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(RolePermission, { roleGuid: guid });
      if (permissionGuids.length) {
        await manager.insert(
          RolePermission,
          permissionGuids.map((permissionGuid) => ({
            roleGuid: guid,
            permissionGuid,
          })),
        );
      }
    });

    // 失效该角色所有用户的会话，使其重新登录刷新权限
    await this.revokeSessionsForRole(guid);
    this.logger.log(`角色 ${guid} 权限已更新，已失效相关会话`);
  }

  /**
   * 同步内置角色
   * 启动时调用：upsert 内置角色并重写其权限映射（不失效会话）
   */
  async syncBuiltInRoles(): Promise<void> {
    for (const def of BUILT_IN_ROLES) {
      let role = await this.roleRepository.findOne({
        where: { code: def.code },
      });
      if (!role) {
        role = this.roleRepository.create({
          guid: uuidv4(),
          code: def.code,
          name: def.name,
          description: def.description,
          isBuiltIn: true,
        });
        await this.roleRepository.save(role);
      } else if (
        !role.isBuiltIn ||
        role.name !== def.name ||
        (role.description ?? null) !== (def.description ?? null)
      ) {
        role.isBuiltIn = true;
        role.name = def.name;
        role.description = def.description;
        await this.roleRepository.save(role);
      }

      const permissionGuids = await this.resolvePermissionGuidsByCodes(
        def.permissions,
      );

      await this.dataSource.transaction(async (manager) => {
        await manager.delete(RolePermission, { roleGuid: role!.guid });
        if (permissionGuids.length) {
          await manager.insert(
            RolePermission,
            permissionGuids.map((permissionGuid) => ({
              roleGuid: role!.guid,
              permissionGuid,
            })),
          );
        }
      });
    }
    this.logger.log(`同步内置角色: ${BUILT_IN_ROLES.map((r) => r.code).join(', ')}`);
  }

  /**
   * 根据权限码解析权限 GUID，校验全部存在
   */
  private async resolvePermissionGuidsByCodes(
    codes: string[],
  ): Promise<string[]> {
    const unique = [...new Set(codes)];
    if (!unique.length) return [];
    const perms = await this.permissionRepository.find({
      where: { code: In(unique) },
    });
    const found = new Set(perms.map((p) => p.code));
    const missing = unique.filter((c) => !found.has(c));
    if (missing.length) {
      throw new BadRequestException(`权限码不存在: ${missing.join(', ')}`);
    }
    return perms.map((p) => p.guid);
  }

  /**
   * 失效某角色下所有用户的会话
   */
  private async revokeSessionsForRole(roleGuid: string): Promise<void> {
    const userRoles = await this.userRoleRepository.find({
      where: { roleGuid },
      select: ['userGuid'],
    });
    if (!userRoles.length) return;
    const userGuids = userRoles.map((ur) => ur.userGuid);
    await this.userTokenRepository.update(
      { userGuid: In(userGuids), isRevoked: false },
      { isRevoked: true },
    );
  }
}
