import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NexusController } from './nexus.controller';
import { NexusService } from './nexus.service';
import { NexusToken } from './entities/nexus-token.entity';

@Module({
  imports: [TypeOrmModule.forFeature([NexusToken])],
  controllers: [NexusController],
  providers: [NexusService],
  exports: [NexusService],
})
export class NexusModule {}
