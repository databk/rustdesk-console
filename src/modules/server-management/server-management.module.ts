import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementService } from './server-management.service';

@Module({
  imports: [RbacModule],
  controllers: [ServerManagementController],
  providers: [ServerManagementService],
})
export class ServerManagementModule {}
