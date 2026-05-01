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
import { AuthModule } from '../auth/auth.module';

/**
 * Dashboard 模块
 * 提供数据统计和分析功能
 *
 * 导入模块：
 * - TypeOrmModule
 * - AuthModule
 *
 * 提供服务：
 * - DashboardService
 */
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
    ]),
    AuthModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
