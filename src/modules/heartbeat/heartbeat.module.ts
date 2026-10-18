import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { DisconnectStoreService } from './services/disconnect-store.service';
import { HeartbeatCacheService } from './services/heartbeat-cache.service';
import { Peer } from '../../common/entities';
import { DeviceTombstone } from '../device-group/entities/device-tombstone.entity';
import { ActiveConnection } from './entities/active-connection.entity';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Peer, ActiveConnection, DeviceTombstone]),
    StrategyModule,
  ],
  controllers: [HeartbeatController],
  providers: [HeartbeatService, DisconnectStoreService, HeartbeatCacheService],
  exports: [HeartbeatService, DisconnectStoreService],
})
export class HeartbeatModule {}
