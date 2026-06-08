import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../entities/system-setting.entity';
import { UpdateAuditConfigDto } from '../dto/audit-config.dto';

/**
 * 审计日志保留配置服务
 * 使用通用 SystemSetting 表管理审计日志保留策略
 */
@Injectable()
export class AuditSettingsService {
  private readonly logger = new Logger(AuditSettingsService.name);

  /** 设置分类 */
  private readonly CATEGORY = 'audit';

  /** 默认保留天数 */
  private readonly DEFAULT_RETENTION_DAYS = 90;

  /** 默认自动清理开关 */
  private readonly DEFAULT_AUTO_CLEANUP_ENABLED = true;

  /** 审计设置键名 */
  private readonly AUDIT_KEYS = {
    RETENTION_DAYS: 'audit.retentionDays',
    AUTO_CLEANUP_ENABLED: 'audit.autoCleanupEnabled',
  } as const;

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * 获取审计日志保留配置
   */
  async getRetentionConfig(): Promise<{
    retentionDays: number;
    autoCleanupEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const settings = await this.getAuditSettings();

    const anySetting = await this.settingRepository.findOne({
      where: { key: this.AUDIT_KEYS.RETENTION_DAYS },
    });

    return {
      retentionDays: settings.has(this.AUDIT_KEYS.RETENTION_DAYS)
        ? parseInt(settings.get(this.AUDIT_KEYS.RETENTION_DAYS)!, 10)
        : this.DEFAULT_RETENTION_DAYS,
      autoCleanupEnabled: settings.has(this.AUDIT_KEYS.AUTO_CLEANUP_ENABLED)
        ? settings.get(this.AUDIT_KEYS.AUTO_CLEANUP_ENABLED) === 'true'
        : this.DEFAULT_AUTO_CLEANUP_ENABLED,
      createdAt: anySetting?.createdAt || new Date(),
      updatedAt: anySetting?.updatedAt || new Date(),
    };
  }

  /**
   * 更新审计日志保留配置（Upsert语义）
   */
  async updateRetentionConfig(
    dto: UpdateAuditConfigDto,
  ): Promise<{
    retentionDays: number;
    autoCleanupEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const updates: Record<string, string> = {};

    if (dto.retentionDays !== undefined) {
      updates[this.AUDIT_KEYS.RETENTION_DAYS] = String(dto.retentionDays);
    }
    if (dto.autoCleanupEnabled !== undefined) {
      updates[this.AUDIT_KEYS.AUTO_CLEANUP_ENABLED] = String(
        dto.autoCleanupEnabled,
      );
    }

    if (Object.keys(updates).length > 0) {
      await this.setMultipleSettings(updates);
      this.logger.log(
        `Audit retention config updated: ${JSON.stringify(updates)}`,
      );
    }

    return this.getRetentionConfig();
  }

  /**
   * 获取所有审计设置
   */
  private async getAuditSettings(): Promise<Map<string, string>> {
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
        });
      }

      await this.settingRepository.save(setting);
    }
  }
}
