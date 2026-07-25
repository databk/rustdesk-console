import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { ADMIN_ROLE_CODE } from '../constants/permission-catalog';
import { PermissionService } from './permission.service';
import { RoleService } from './role.service';

/**
 * RBAC 种子服务
 *
 * 应用启动时同步：
 * 1. 权限目录 upsert（代码常量 -> DB）
 * 2. 内置角色 upsert 并重写权限映射
 * 3. 为所有 isAdmin 用户绑定 admin 角色（一致性展示，best-effort）
 */
@Injectable()
export class RbacSeedService implements OnModuleInit {
  private readonly logger = new Logger(RbacSeedService.name);

  constructor(
    private readonly permissionService: PermissionService,
    private readonly roleService: RoleService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.permissionService.upsertCatalog();
    await this.roleService.syncBuiltInRoles();
    await this.bindAdminRoleToAdminUsers();
  }

  /**
   * 为所有 isAdmin=true 的用户绑定 admin 角色
   * 幂等：已存在则跳过
   */
  private async bindAdminRoleToAdminUsers(): Promise<void> {
    const adminRole = await this.roleRepository.findOne({
      where: { code: ADMIN_ROLE_CODE },
    });
    if (!adminRole) {
      return;
    }

    const admins = await this.userRepository.find({
      where: { isAdmin: true },
      select: ['guid', 'username'],
    });

    for (const admin of admins) {
      const exists = await this.userRoleRepository.exist({
        where: { userGuid: admin.guid, roleGuid: adminRole.guid },
      });
      if (!exists) {
        await this.userRoleRepository.insert({
          userGuid: admin.guid,
          roleGuid: adminRole.guid,
        });
        this.logger.log(`已为管理员绑定 admin 角色: ${admin.username}`);
      }
    }
  }
}
