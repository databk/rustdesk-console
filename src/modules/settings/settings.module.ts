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
 * 系统设置模块
 * 管理系统配置，包括 SMTP 配置、通用设置等
 *
 * 使用通用 SystemSetting 表存储各类设置项
 *
 * 导出服务：
 * - SmtpSettingsService（供 EmailModule 等其他模块使用）
 * - GeneralSettingsService（供 AuditModule / AuthModule 等其他模块使用）
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
