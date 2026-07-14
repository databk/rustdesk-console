import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NexusController } from './nexus.controller';
import { NexusService } from './nexus.service';
import { NexusToken } from './entities/nexus-token.entity';
import { NexusBuild } from './entities/nexus-build.entity';
import { UpdateCheckModule } from '../update-check/update-check.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NexusToken, NexusBuild]),
    UpdateCheckModule,
  ],
  controllers: [NexusController],
  providers: [NexusService],
  exports: [NexusService],
})
export class NexusModule {}
