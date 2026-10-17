import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { RbacModule } from '../rbac/rbac.module';
import { ServerEventsService } from './server-events.service';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementSettingsController } from './server-management-settings.controller';
import { ServerManagementSettingsService } from './server-management-settings.service';
import { ServerManagementService } from './server-management.service';

@Module({
  imports: [RbacModule, TypeOrmModule.forFeature([SystemSetting])],
  controllers: [ServerManagementController, ServerManagementSettingsController],
  providers: [
    ServerManagementService,
    ServerManagementSettingsService,
    ServerEventsService,
    AdminGuard,
  ],
  exports: [ServerManagementService],
})
export class ServerManagementModule {}
