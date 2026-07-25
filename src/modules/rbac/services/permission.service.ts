import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Permission } from '../entities/permission.entity';
import { UserRole } from '../entities/user-role.entity';
import { PERMISSION_CATALOG } from '../constants/permission-catalog';

/**
 * 权限服务
 *
 * 职责：
 * - 维护权限目录（启动时 upsert 代码常量定义的权限）
 * - 查询用户有效角色与权限（用于登录时写入 JWT）
 */
@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  /**
   * 列出全部权限目录（按模块、权限码排序）
   */
  async listPermissions(): Promise<Permission[]> {
    return this.permissionRepository.find({
      order: { module: 'ASC', code: 'ASC' },
    });
  }

  /**
   * upsert 权限目录
   * 以 code 为唯一键，更新名称/模块/描述；新增则分配 guid
   */
  async upsertCatalog(): Promise<void> {
    const existing = await this.permissionRepository.find();
    const byCode = new Map(existing.map((p) => [p.code, p]));
    const toSave: Permission[] = [];

    for (const def of PERMISSION_CATALOG) {
      const e = byCode.get(def.code);
      if (e) {
        if (
          e.name !== def.name ||
          e.module !== def.module ||
          (e.description ?? null) !== (def.description ?? null)
        ) {
          e.name = def.name;
          e.module = def.module;
          e.description = def.description;
          toSave.push(e);
        }
      } else {
        toSave.push(
          this.permissionRepository.create({
            guid: uuidv4(),
            code: def.code,
            name: def.name,
            module: def.module,
            description: def.description,
          }),
        );
      }
    }

    if (toSave.length) {
      await this.permissionRepository.save(toSave);
      this.logger.log(`同步权限目录，处理 ${toSave.length} 条`);
    }
  }

  /**
   * 获取用户的有效角色与权限
   *
   * 汇总用户绑定的所有角色，权限取并集。
   * 单次查询：user_roles -> roles -> role_permissions -> permissions。
   *
   * @returns { roles: 角色code数组, permissions: 权限code数组 }
   */
  async getEffectivePermissions(
    userGuid: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const rows = await this.userRoleRepository
      .createQueryBuilder('ur')
      .innerJoin('ur.role', 'role')
      .leftJoin('role.rolePermissions', 'rp')
      .leftJoin('rp.permission', 'permission')
      .where('ur.userGuid = :userGuid', { userGuid })
      .select(['role.code AS roleCode', 'permission.code AS permissionCode'])
      .getRawMany<{ roleCode: string; permissionCode: string | null }>();

    const roles = new Set<string>();
    const permissions = new Set<string>();
    for (const row of rows) {
      roles.add(row.roleCode);
      if (row.permissionCode) {
        permissions.add(row.permissionCode);
      }
    }

    return { roles: [...roles], permissions: [...permissions] };
  }
}
