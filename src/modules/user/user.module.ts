import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { UserToken } from './entities/user-token.entity';
import { Peer, Sysinfo } from '../../common/entities';
import { AuthModule } from '../auth/auth.module';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { DeviceGroupUserPermission } from '../device-group/entities/device-group-user-permission.entity';

/**
 * 用户模块
 * 负责用户管理和用户令牌管理
 *
 * 导入模块：
 * - TypeOrmModule
 *
 * 导出服务：
 * - UserService
 *
 * 提供服务：
 * - UserService
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserToken,
      Peer,
      Sysinfo,
      DeviceGroup,
      DeviceGroupUserPermission,
    ]),
    AuthModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
