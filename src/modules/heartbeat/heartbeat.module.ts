import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { DisconnectStoreService } from './services/disconnect-store.service';
import { Peer } from '../../common/entities';
import { ActiveConnection } from './entities/active-connection.entity';

/**
 * 心跳模块
 * 负责设备心跳处理、在线状态维护和连接管理
 *
 * 导入模块：
 * - TypeOrmModule
 *
 * 导出服务：
 * - HeartbeatService
 * - DisconnectStoreService
 *
 * 提供服务：
 * - HeartbeatService
 * - DisconnectStoreService
 */
@Module({
  imports: [TypeOrmModule.forFeature([Peer, ActiveConnection])],
  controllers: [HeartbeatController],
  providers: [HeartbeatService, DisconnectStoreService],
  exports: [HeartbeatService, DisconnectStoreService],
})
export class HeartbeatModule {}
