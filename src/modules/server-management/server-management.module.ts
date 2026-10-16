import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { ServerEventsService } from './server-events.service';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementService } from './server-management.service';

@Module({
  imports: [RbacModule],
  controllers: [ServerManagementController],
  providers: [ServerManagementService, ServerEventsService],
  exports: [ServerManagementService],
})
export class ServerManagementModule {}
