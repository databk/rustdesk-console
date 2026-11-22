import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/entities/user.entity';
import { SettingsModule } from '../settings/settings.module';
import { WebClientModule } from '../web-client/web-client.module';
import { UserModule } from '../user/user.module';
import { ServerManagementModule } from '../server-management/server-management.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

/**
 * SetupModule
 * Runs the one-time "first run" wizard. Publicly accessible (before any admin
 * account exists) and intentionally independent of UserModule ↔ SettingsModule
 * circular dependencies.
 *
 * Imports:
 * - SettingsModule          (GeneralSettingsService — writing site URLs)
 * - WebClientModule         (WebClientSettingsService, WebClientService — web client defaults)
 * - ServerManagementModule  (ServerManagementSettingsService — auto-configure hbbs management API)
 * - UserModule              (UserService.changePassword — optional admin password reset)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    SettingsModule,
    WebClientModule,
    ServerManagementModule,
    UserModule,
  ],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
