import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { User } from '../user/entities/user.entity';
import { Peer } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { UpdateCheckController } from './update-check.controller';
import { UpdateCheckService } from './update-check.service';

/**
 * 更新检查模块
 * 提供版本更新检查、前端版本上报、更新通道管理功能
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SystemSetting,
      User,
      Peer,
      DeviceGroup,
      ConnectionAudit,
    ]),
  ],
  controllers: [UpdateCheckController],
  providers: [UpdateCheckService],
  exports: [UpdateCheckService],
})
export class UpdateCheckModule {}
