import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { SystemSetting } from '../entities/system-setting.entity';
import { UpdateSmtpConfigDto, TestSmtpConfigDto } from '../dto/smtp-config.dto';

/**
 * SMTP configuration service
 * Manages SMTP configuration using the generic SystemSetting table
 */
@Injectable()
export class SmtpSettingsService {
  private readonly logger = new Logger(SmtpSettingsService.name);

  /** Setting category */
  private readonly CATEGORY = 'smtp';

  /** Password masking placeholder */
  private readonly PASS_MASK = '******';

  /** SMTP setting keys */
  private readonly SMTP_KEYS = {
    HOST: 'smtp.host',
    PORT: 'smtp.port',
    SECURE: 'smtp.secure',
    USER: 'smtp.user',
    PASS: 'smtp.pass',
    FROM: 'smtp.from',
    ENABLED: 'smtp.enabled',
  } as const;

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * Get SMTP configuration (including password, for internal service use)
   */
  async getActiveConfig(): Promise<{
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
    enabled: boolean;
  } | null> {
    const settings = await this.getSmtpSettings();

    if (!settings.get(this.SMTP_KEYS.HOST)) {
      return null;
    }

    return {
      host: settings.get(this.SMTP_KEYS.HOST) || '',
      port: parseInt(settings.get(this.SMTP_KEYS.PORT) || '587', 10),
      secure: settings.get(this.SMTP_KEYS.SECURE) === 'true',
      user: settings.get(this.SMTP_KEYS.USER) || undefined,
      pass: settings.get(this.SMTP_KEYS.PASS) || undefined,
      from: settings.get(this.SMTP_KEYS.FROM) || '',
      enabled: settings.get(this.SMTP_KEYS.ENABLED) !== 'false',
    };
  }

  /**
   * Get SMTP configuration (password masked, for API responses)
   * Throws NotFoundException if the configuration does not exist
   */
  async getSmtpConfig(): Promise<{
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass: string;
    from: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const settings = await this.getSmtpSettings();

    if (!settings.get(this.SMTP_KEYS.HOST)) {
      throw new NotFoundException('SMTP configuration does not exist');
    }

    // Use the timestamp of any one setting as the overall time
    const anySetting = await this.settingRepository.findOne({
      where: { key: this.SMTP_KEYS.HOST },
    });

    return {
      host: settings.get(this.SMTP_KEYS.HOST) || '',
      port: parseInt(settings.get(this.SMTP_KEYS.PORT) || '587', 10),
      secure: settings.get(this.SMTP_KEYS.SECURE) === 'true',
      user: settings.get(this.SMTP_KEYS.USER) || undefined,
      pass: this.PASS_MASK,
      from: settings.get(this.SMTP_KEYS.FROM) || '',
      enabled: settings.get(this.SMTP_KEYS.ENABLED) !== 'false',
      createdAt: anySetting?.createdAt || new Date(),
      updatedAt: anySetting?.updatedAt || new Date(),
    };
  }

  /**
   * Update SMTP configuration (Upsert semantics)
   * Creates the configuration if it does not exist, updates it otherwise
   * If the pass field is the masking placeholder, the password is not updated
   */
  async updateSmtpConfig(dto: UpdateSmtpConfigDto): Promise<{
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass: string;
    from: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const existing = await this.settingRepository.findOne({
      where: { key: this.SMTP_KEYS.HOST },
    });

    if (!existing) {
      // Configuration does not exist, create a new one
      await this.setMultipleSettings({
        [this.SMTP_KEYS.HOST]: dto.host || '',
        [this.SMTP_KEYS.PORT]: String(dto.port ?? 587),
        [this.SMTP_KEYS.SECURE]: String(dto.secure ?? false),
        [this.SMTP_KEYS.USER]: dto.user || '',
        [this.SMTP_KEYS.PASS]: dto.pass || '',
        [this.SMTP_KEYS.FROM]: dto.from || '',
        [this.SMTP_KEYS.ENABLED]: String(dto.enabled ?? true),
      });
      this.logger.log('SMTP configuration created');
    } else {
      // Configuration exists, update it
      const updates: Record<string, string> = {};

      if (dto.host !== undefined) updates[this.SMTP_KEYS.HOST] = dto.host;
      if (dto.port !== undefined)
        updates[this.SMTP_KEYS.PORT] = String(dto.port);
      if (dto.secure !== undefined)
        updates[this.SMTP_KEYS.SECURE] = String(dto.secure);
      if (dto.user !== undefined) updates[this.SMTP_KEYS.USER] = dto.user;
      if (dto.from !== undefined) updates[this.SMTP_KEYS.FROM] = dto.from;
      if (dto.enabled !== undefined)
        updates[this.SMTP_KEYS.ENABLED] = String(dto.enabled);
      if (dto.pass !== undefined && dto.pass !== this.PASS_MASK) {
        updates[this.SMTP_KEYS.PASS] = dto.pass;
      }

      if (Object.keys(updates).length > 0) {
        await this.setMultipleSettings(updates);
      }
      this.logger.log('SMTP configuration updated');
    }

    return this.getSmtpConfig();
  }

  /**
   * Test SMTP connection
   */
  async testSmtpConnection(
    dto?: TestSmtpConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    let host: string;
    let port: number;
    let secure: boolean;
    let user: string | undefined;
    let pass: string | undefined;

    if (dto && dto.host) {
      host = dto.host;
      port = dto.port ?? 587;
      secure = dto.secure ?? false;
      user = dto.user;
      pass = dto.pass;
    } else {
      const config = await this.getActiveConfig();
      if (!config) {
        return {
          success: false,
          message:
            'SMTP configuration does not exist, please configure it first',
        };
      }
      host = config.host;
      port = config.port;
      secure = config.secure;
      user = config.user;
      pass = config.pass;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user || pass ? { auth: { user, pass } } : {}),
    });

    try {
      await transporter.verify();
      this.logger.log('SMTP connection test succeeded');
      return { success: true, message: 'SMTP connection test succeeded' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`SMTP connection test failed: ${message}`);
      return {
        success: false,
        message: `SMTP connection test failed: ${message}`,
      };
    } finally {
      transporter.close();
    }
  }

  /**
   * Get all SMTP settings
   */
  private async getSmtpSettings(): Promise<Map<string, string>> {
    const settings = await this.settingRepository.find({
      where: { category: this.CATEGORY },
    });

    const map = new Map<string, string>();
    for (const setting of settings) {
      map.set(setting.key, setting.value);
    }
    return map;
  }

  /**
   * Set multiple configuration items in batch
   */
  private async setMultipleSettings(
    data: Record<string, string>,
  ): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      let setting = await this.settingRepository.findOne({ where: { key } });

      if (setting) {
        setting.value = value;
      } else {
        setting = this.settingRepository.create({
          key,
          value,
          category: this.CATEGORY,
          isSensitive: key === this.SMTP_KEYS.PASS,
        });
      }

      await this.settingRepository.save(setting);
    }
  }
}
