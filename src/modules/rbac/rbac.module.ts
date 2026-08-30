import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Peer } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { User } from '../user/entities/user.entity';
import { PermissionController } from './permission.controller';
import { RoleController } from './role.controller';
import { UserRoleController } from './user-role.controller';
import { ConsoleAudit } from './entities/console-audit.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRoleAssignment } from './entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from './entities/user-role-assignment-device-group.entity';
import { RbacGuard } from './guards/rbac.guard';
import { RbacAuditService } from './services/rbac-audit.service';
import { RbacAuthorizationService } from './services/rbac-authorization.service';
import { RoleService } from './services/role.service';
import { UserRoleService } from './services/user-role.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      RolePermission,
      UserRoleAssignment,
      UserRoleAssignmentDeviceGroup,
      ConsoleAudit,
      User,
      DeviceGroup,
      Peer,
    ]),
  ],
  controllers: [PermissionController, RoleController, UserRoleController],
  providers: [
    RbacAuditService,
    RbacAuthorizationService,
    RoleService,
    UserRoleService,
    RbacGuard,
  ],
  exports: [RbacAuditService, RbacAuthorizationService, RbacGuard],
})
export class RbacModule {}
