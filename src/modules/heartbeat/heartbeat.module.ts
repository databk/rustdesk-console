import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { DisconnectStoreService } from './services/disconnect-store.service';
import { Peer } from '../../common/entities';
import { ActiveConnection } from './entities/active-connection.entity';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [TypeOrmModule.forFeature([Peer, ActiveConnection]), StrategyModule],
  controllers: [HeartbeatController],
  providers: [HeartbeatService, DisconnectStoreService],
  exports: [HeartbeatService, DisconnectStoreService],
})
export class HeartbeatModule {}
