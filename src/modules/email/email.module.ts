import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SettingsModule } from '../settings/settings.module';

/**
 * Email module
 * Responsible for sending emails and managing verification codes
 *
 * Imported modules:
 * - SettingsModule(to obtain SMTP configuration)
 *
 * Exported services:
 * - EmailService
 *
 * Provided services:
 * - EmailService
 *
 * Note:
 * SMTP configuration is now read dynamically from the database; static MailerModule.forRoot is no longer used
 */
@Module({
  imports: [SettingsModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
