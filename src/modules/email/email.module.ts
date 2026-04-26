import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SettingsModule } from '../settings/settings.module';

/**
 * 邮件模块
 * 负责邮件发送和验证码管理
 *
 * 导入模块：
 * - SettingsModule（获取 SMTP 配置）
 *
 * 导出服务：
 * - EmailService
 *
 * 提供服务：
 * - EmailService
 *
 * 注意：
 * SMTP 配置现在从数据库动态读取，不再使用静态的 MailerModule.forRoot
 */
@Module({
  imports: [SettingsModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
