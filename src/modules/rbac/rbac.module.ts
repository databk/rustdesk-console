import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { User } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { PermissionController } from './permission.controller';
import { RoleController } from './role.controller';
import { UserRoleController } from './user-role.controller';
import { PermissionService } from './services/permission.service';
import { RoleService } from './services/role.service';
import { UserRoleService } from './services/user-role.service';
import { RbacSeedService } from './services/rbac-seed.service';
import { PermissionsGuard } from './guards/permissions.guard';

/**
 * RBAC 模块
 *
 * 提供：
 * - 权限目录与角色/用户角色管理 API
 * - PermissionService（供 AuthModule 登录时加载权限写入 JWT）
 * - PermissionsGuard（供 AppModule 注册为全局 APP_GUARD）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      Permission,
      RolePermission,
      UserRole,
      User,
      UserToken,
    ]),
  ],
  controllers: [PermissionController, RoleController, UserRoleController],
  providers: [
    PermissionService,
    RoleService,
    UserRoleService,
    RbacSeedService,
    PermissionsGuard,
  ],
  exports: [PermissionService, PermissionsGuard],
})
export class RbacModule {}
