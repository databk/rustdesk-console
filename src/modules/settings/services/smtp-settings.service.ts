import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { SystemSetting } from '../entities/system-setting.entity';
import {
  UpdateSmtpConfigDto,
  TestSmtpConfigDto,
} from '../dto/smtp-config.dto';

/**
 * SMTP 配置服务
 * 使用通用 SystemSetting 表管理 SMTP 配置
 */
@Injectable()
export class SmtpSettingsService {
  private readonly logger = new Logger(SmtpSettingsService.name);

  /** 设置分类 */
  private readonly CATEGORY = 'smtp';

  /** 密码脱敏占位符 */
  private readonly PASS_MASK = '******';

  /** SMTP 设置键名 */
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
   * 获取 SMTP 配置（含密码，供内部服务使用）
   */
  async getActiveConfig(): Promise<{
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
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
      user: settings.get(this.SMTP_KEYS.USER) || '',
      pass: settings.get(this.SMTP_KEYS.PASS) || '',
      from: settings.get(this.SMTP_KEYS.FROM) || '',
      enabled: settings.get(this.SMTP_KEYS.ENABLED) !== 'false',
    };
  }

  /**
   * 获取 SMTP 配置（密码脱敏，供 API 返回）
   * 如果配置不存在，抛出 NotFoundException
   */
  async getSmtpConfig(): Promise<{
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const settings = await this.getSmtpSettings();

    if (!settings.get(this.SMTP_KEYS.HOST)) {
      throw new NotFoundException('SMTP 配置不存在');
    }

    // 获取任意一个设置的时间戳作为整体时间
    const anySetting = await this.settingRepository.findOne({
      where: { key: this.SMTP_KEYS.HOST },
    });

    return {
      host: settings.get(this.SMTP_KEYS.HOST) || '',
      port: parseInt(settings.get(this.SMTP_KEYS.PORT) || '587', 10),
      secure: settings.get(this.SMTP_KEYS.SECURE) === 'true',
      user: settings.get(this.SMTP_KEYS.USER) || '',
      pass: this.PASS_MASK,
      from: settings.get(this.SMTP_KEYS.FROM) || '',
      enabled: settings.get(this.SMTP_KEYS.ENABLED) !== 'false',
      createdAt: anySetting?.createdAt || new Date(),
      updatedAt: anySetting?.updatedAt || new Date(),
    };
  }

  /**
   * 更新 SMTP 配置（Upsert语义）
   * 如果配置不存在则创建，存在则更新
   * 如果 pass 字段为脱敏占位符，则不更新密码
   */
  async updateSmtpConfig(dto: UpdateSmtpConfigDto): Promise<{
    host: string;
    port: number;
    secure: boolean;
    user: string;
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
      // 配置不存在，创建新配置
      await this.setMultipleSettings({
        [this.SMTP_KEYS.HOST]: dto.host || '',
        [this.SMTP_KEYS.PORT]: String(dto.port ?? 587),
        [this.SMTP_KEYS.SECURE]: String(dto.secure ?? false),
        [this.SMTP_KEYS.USER]: dto.user || '',
        [this.SMTP_KEYS.PASS]: dto.pass || '',
        [this.SMTP_KEYS.FROM]: dto.from || '',
        [this.SMTP_KEYS.ENABLED]: String(dto.enabled ?? true),
      });
      this.logger.log('SMTP 配置已创建');
    } else {
      // 配置已存在，更新配置
      const updates: Record<string, string> = {};

      if (dto.host !== undefined) updates[this.SMTP_KEYS.HOST] = dto.host;
      if (dto.port !== undefined) updates[this.SMTP_KEYS.PORT] = String(dto.port);
      if (dto.secure !== undefined) updates[this.SMTP_KEYS.SECURE] = String(dto.secure);
      if (dto.user !== undefined) updates[this.SMTP_KEYS.USER] = dto.user;
      if (dto.from !== undefined) updates[this.SMTP_KEYS.FROM] = dto.from;
      if (dto.enabled !== undefined) updates[this.SMTP_KEYS.ENABLED] = String(dto.enabled);
      if (dto.pass !== undefined && dto.pass !== this.PASS_MASK) {
        updates[this.SMTP_KEYS.PASS] = dto.pass;
      }

      if (Object.keys(updates).length > 0) {
        await this.setMultipleSettings(updates);
      }
      this.logger.log('SMTP 配置已更新');
    }

    return this.getSmtpConfig();
  }

  /**
   * 测试 SMTP 连接
   */
  async testSmtpConnection(
    dto?: TestSmtpConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    let host: string;
    let port: number;
    let secure: boolean;
    let user: string;
    let pass: string;

    if (dto && dto.host) {
      host = dto.host;
      port = dto.port ?? 587;
      secure = dto.secure ?? false;
      user = dto.user ?? '';
      pass = dto.pass ?? '';
    } else {
      const config = await this.getActiveConfig();
      if (!config) {
        return { success: false, message: 'SMTP 配置不存在，请先配置' };
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
      auth: { user, pass },
    });

    try {
      await transporter.verify();
      this.logger.log('SMTP 连接测试成功');
      return { success: true, message: 'SMTP 连接测试成功' };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`SMTP 连接测试失败: ${message}`);
      return { success: false, message: `SMTP 连接测试失败: ${message}` };
    } finally {
      transporter.close();
    }
  }

  /**
   * 获取所有 SMTP 设置
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
   * 批量设置多个配置项
   */
  private async setMultipleSettings(data: Record<string, string>): Promise<void> {
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
