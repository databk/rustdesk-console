import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as Handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SmtpSettingsService } from '../settings/services/smtp-settings.service';
import { resolveAssetPath } from '../../common/utils/runtime-paths';

@Injectable()
/**
 * EmailService
 * Responsible for sending emails, including verification code emails
 *
 * Use case:
 * Used for the email verification code login feature
 *
 * Implementation:
 * Reads SMTP configuration dynamically from the database and sends emails directly with nodemailer
 */
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /** Template cache */
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(private readonly smtpSettingsService: SmtpSettingsService) {}

  /**
   * Send verification code email
   */
  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    try {
      const config = await this.smtpSettingsService.getActiveConfig();
      if (!config) {
        this.logger.warn(
          'SMTP is not configured or not enabled, cannot send email',
        );
        return false;
      }

      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user || config.pass
          ? { auth: { user: config.user, pass: config.pass } }
          : {}),
      });

      // Render template
      const html = await this.renderTemplate('verification-code', {
        code,
        expiresIn: '5 minutes',
      });

      await transporter.sendMail({
        from: config.from,
        to: email,
        subject: 'Login verification code',
        html,
      });

      transporter.close();
      this.logger.log(`Verification code email sent to: ${email}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send verification code email: ${email}`,
        error,
      );
      return false;
    }
  }

  /**
   * Send invitation email
   */
  async sendInvitation(
    email: string,
    inviteUrl: string,
    expiresIn: string = '7 days',
  ): Promise<boolean> {
    try {
      const config = await this.smtpSettingsService.getActiveConfig();
      if (!config) {
        this.logger.warn(
          'SMTP is not configured or not enabled, cannot send invitation email',
        );
        return false;
      }

      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user || config.pass
          ? { auth: { user: config.user, pass: config.pass } }
          : {}),
      });

      const html = await this.renderTemplate('invitation', {
        serviceName: 'RustDesk Console',
        inviteUrl,
        expiresIn,
      });

      await transporter.sendMail({
        from: config.from,
        to: email,
        subject: 'Invitation to join RustDesk Console',
        html,
      });

      transporter.close();
      this.logger.log(`Invitation email sent to: ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send invitation email: ${email}`, error);
      return false;
    }
  }

  /**
   * Render Handlebars email template
   */
  private async renderTemplate(
    templateName: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    let template = this.templateCache.get(templateName);
    if (!template) {
      const templatePath = resolveAssetPath(
        __dirname,
        path.join('templates', `${templateName}.hbs`),
        path.join('templates', 'email', `${templateName}.hbs`),
      );
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      template = Handlebars.compile(templateContent);
      this.templateCache.set(templateName, template);
    }

    return template(context);
  }
}
