import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { User } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { Peer } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { FileAudit } from '../audit/entities/file-audit.entity';
import { AlarmAudit } from '../audit/entities/alarm-audit.entity';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { AddressBook } from '../address-book/entities/address-book.entity';
import { UserGroup } from '../user-group/entities/user-group.entity';
import { Role } from '../rbac/entities/role.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserToken,
      Peer,
      DeviceGroup,
      ConnectionAudit,
      FileAudit,
      AlarmAudit,
      Sysinfo,
      AddressBook,
      UserGroup,
      Role,
      Strategy,
    ]),
    AuthModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
