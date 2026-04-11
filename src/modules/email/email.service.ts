import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
/**
 * EmailService
 * 负责发送邮件，包括验证码邮件
 *
 * 使用场景：
 * 用于邮箱验证码登录功能
 */
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly mailerService: MailerService) {}

  /**
   * 发送验证码邮件
   */
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: '登录验证码',
        template: './verification-code',
        context: {
          code,
          expiresIn: '5分钟',
        },
      });
      this.logger.log(`验证码邮件已发送至: ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`发送验证码邮件失败: ${email}`, error);
      return false;
    }
  }
}
