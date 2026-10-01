import { Module } from '@nestjs/common';
import { SystemUpdateController } from './system-update.controller';
import { SystemUpdateHealthController } from './system-update-health.controller';
import { SystemUpdateService } from './system-update.service';
@Module({
  controllers: [SystemUpdateController, SystemUpdateHealthController],
  providers: [SystemUpdateService],
})
export class SystemUpdateModule {}
