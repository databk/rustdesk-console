import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceGroupController } from './device-group.controller';
import { DeviceGroupService } from './device-group.service';
import { PeerService } from './peer.service';
import { DeviceGroup } from './entities/device-group.entity';
import { DeviceGroupUserPermission } from './entities/device-group-user-permission.entity';
import { UserUserPermission } from './entities/user-user-permission.entity';
import { Peer, Sysinfo } from '../../common/entities';
import { User } from '../user/entities/user.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { AuthModule } from '../auth/auth.module';
import { HeartbeatModule } from '../heartbeat/heartbeat.module';
import { RbacModule } from '../rbac/rbac.module';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * 设备组模块
 * 负责设备组管理和权限控制
 *
 * 导入模块：
 * - TypeOrmModule
 * - AuthModule
 * - HeartbeatModule
 *
 * 导出服务：
 * - DeviceGroupService
 * - PeerService
 *
 * 提供服务：
 * - DeviceGroupService
 * - PeerService
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeviceGroup,
      DeviceGroupUserPermission,
      UserUserPermission,
      Peer,
      Sysinfo,
      User,
      Strategy,
    ]),
    AuthModule,
    HeartbeatModule,
    RbacModule,
  ],
  controllers: [DeviceGroupController],
  providers: [DeviceGroupService, PeerService, AdminGuard],
  exports: [DeviceGroupService, PeerService],
})
export class DeviceGroupModule {}
