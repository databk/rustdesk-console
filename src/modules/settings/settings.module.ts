import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmtpConfig } from './entities/smtp-config.entity';
import { SettingsController } from './settings.controller';
import { SmtpSettingsService } from './services/smtp-settings.service';

/**
 * 系统设置模块
 * 管理系统配置，包括 SMTP 配置等
 *
 * 导出服务：
 * - SmtpSettingsService（供 EmailModule 等其他模块使用）
 */
@Module({
  imports: [TypeOrmModule.forFeature([SmtpConfig])],
  controllers: [SettingsController],
  providers: [SmtpSettingsService],
  exports: [SmtpSettingsService],
})
export class SettingsModule {}
