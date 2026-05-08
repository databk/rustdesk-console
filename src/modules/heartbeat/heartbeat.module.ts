import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { Peer } from '../../common/entities';
import { DeviceThrottlerGuard } from '../../common/guards/device-throttler.guard';

/**
 * 心跳模块
 * 负责设备心跳处理和在线状态维护
 *
 * 导入模块：
 * - TypeOrmModule
 *
 * 导出服务：
 * - HeartbeatService
 *
 * 提供服务：
 * - HeartbeatService
 */
@Module({
  imports: [TypeOrmModule.forFeature([Peer])],
  controllers: [HeartbeatController],
  providers: [
    HeartbeatService,
  ],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
