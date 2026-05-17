import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as Handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SmtpSettingsService } from '../settings/services/smtp-settings.service';

@Injectable()
/**
 * EmailService
 * 负责发送邮件，包括验证码邮件
 *
 * 使用场景：
 * 用于邮箱验证码登录功能
 *
 * 实现方式：
 * 从数据库动态读取 SMTP 配置，使用 nodemailer 直接发送邮件
 */
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /** 模板缓存 */
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(private readonly smtpSettingsService: SmtpSettingsService) {}

  /**
   * 发送验证码邮件
   */
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    try {
      const config = await this.smtpSettingsService.getActiveConfig();
      if (!config) {
        this.logger.warn('SMTP 未配置或未启用，无法发送邮件');
        return false;
      }

      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      });

      // 渲染模板
      const html = await this.renderTemplate('verification-code', {
        code,
        expiresIn: '5分钟',
      });

      await transporter.sendMail({
        from: config.from,
        to: email,
        subject: '登录验证码',
        html,
      });

      transporter.close();
      this.logger.log(`验证码邮件已发送至: ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`发送验证码邮件失败: ${email}`, error);
      return false;
    }
  }

  /**
   * 渲染 Handlebars 邮件模板
   */
  private async renderTemplate(
    templateName: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    let template = this.templateCache.get(templateName);
    if (!template) {
      const templatePath = path.join(
        __dirname,
        'templates',
        `${templateName}.hbs`,
      );
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      template = Handlebars.compile(templateContent);
      this.templateCache.set(templateName, template);
    }

    return template(context);
  }
}
