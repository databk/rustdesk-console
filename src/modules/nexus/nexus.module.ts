import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NexusController } from './nexus.controller';
import { NexusService } from './nexus.service';
import { NexusToken } from './entities/nexus-token.entity';
import { NexusBuild } from './entities/nexus-build.entity';

@Module({
  imports: [TypeOrmModule.forFeature([NexusToken, NexusBuild])],
  controllers: [NexusController],
  providers: [NexusService],
  exports: [NexusService],
})
export class NexusModule {}
