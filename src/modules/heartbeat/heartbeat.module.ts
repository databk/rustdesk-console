import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { DisconnectStoreService } from './services/disconnect-store.service';
import { HeartbeatCacheService } from './services/heartbeat-cache.service';
import { HeartbeatHealthService } from './services/heartbeat-health.service';
import { Peer } from '../../common/entities';
import { DeviceTombstone } from '../device-group/entities/device-tombstone.entity';
import { ActiveConnection } from './entities/active-connection.entity';
import { StrategyModule } from '../strategy/strategy.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminGuard } from '../../common/guards/admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Peer, ActiveConnection, DeviceTombstone]),
    StrategyModule,
    SettingsModule,
  ],
  controllers: [HeartbeatController],
  providers: [
    HeartbeatService,
    DisconnectStoreService,
    HeartbeatCacheService,
    HeartbeatHealthService,
    AdminGuard,
  ],
  exports: [HeartbeatService, DisconnectStoreService],
})
export class HeartbeatModule {}
