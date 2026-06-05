import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './user.controller';
import { AvatarController } from './avatar.controller';
import { AdminUserController } from './admin-user.controller';
import { UserService } from './user.service';
import { AdminUserService } from './admin-user.service';
import { User } from './entities/user.entity';
import { UserToken } from './entities/user-token.entity';
import { Peer, Sysinfo } from '../../common/entities';
import { AuthModule } from '../auth/auth.module';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { DeviceGroupUserPermission } from '../device-group/entities/device-group-user-permission.entity';
import { UserUserPermission } from '../device-group/entities/user-user-permission.entity';
import { Strategy } from '../strategy/entities/strategy.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserToken,
      Peer,
      Sysinfo,
      DeviceGroup,
      DeviceGroupUserPermission,
      UserUserPermission,
      Strategy,
    ]),
    AuthModule,
  ],
  controllers: [UserController, AvatarController, AdminUserController],
  providers: [UserService, AdminUserService],
  exports: [UserService],
})
export class UserModule {}
