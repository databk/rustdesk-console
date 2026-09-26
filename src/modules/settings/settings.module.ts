import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from './entities/system-setting.entity';
import { SettingsController } from './settings.controller';
import { SmtpSettingsService } from './services/smtp-settings.service';
import { GeneralSettingsController } from './general-settings.controller';
import { FrontendSettingsController } from './frontend-settings.controller';
import { GeneralSettingsService } from './services/general-settings.service';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * System settings module
 * Manages system configuration, including SMTP settings, general settings, etc.
 *
 * Uses the generic SystemSetting table to store all kinds of settings
 *
 * Exported services:
 * - SmtpSettingsService(for use by other modules such as EmailModule)
 * - GeneralSettingsService(for use by other modules such as AuditModule / AuthModule)
 */
@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting])],
  controllers: [
    SettingsController,
    GeneralSettingsController,
    FrontendSettingsController,
  ],
  providers: [SmtpSettingsService, GeneralSettingsService, AdminGuard],
  exports: [SmtpSettingsService, GeneralSettingsService],
})
export class SettingsModule {}
