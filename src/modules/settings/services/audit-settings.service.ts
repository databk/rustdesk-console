import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../entities/system-setting.entity';

/**
 * 审计日志保留配置服务
 * 使用通用 SystemSetting 表管理审计日志保留策略
 *
 * 保留天数存储在 system_settings 表中：
 * - key: 'audit.retentionDays'
 * - value: 数字字符串，0 表示不自动清理
 * - category: 'audit'
 */
@Injectable()
export class AuditSettingsService {
  private readonly logger = new Logger(AuditSettingsService.name);

  /** 设置分类 */
  private readonly CATEGORY = 'audit';

  /** 默认保留天数（0 表示不自动清理） */
  private readonly DEFAULT_RETENTION_DAYS = 0;

  /** 审计设置键名 */
  private readonly AUDIT_KEY = 'audit.retentionDays';

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * 获取审计日志保留天数
   * @returns 保留天数，0 表示不自动清理
   */
  async getRetentionDays(): Promise<number> {
    const setting = await this.settingRepository.findOne({
      where: { key: this.AUDIT_KEY },
    });

    if (!setting) {
      return this.DEFAULT_RETENTION_DAYS;
    }

    const days = parseInt(setting.value, 10);
    return isNaN(days) ? this.DEFAULT_RETENTION_DAYS : days;
  }

  /**
   * 设置审计日志保留天数
   * @param days 保留天数，0 表示不自动清理
   */
  async setRetentionDays(days: number): Promise<void> {
    let setting = await this.settingRepository.findOne({
      where: { key: this.AUDIT_KEY },
    });

    if (setting) {
      setting.value = String(days);
    } else {
      setting = this.settingRepository.create({
        key: this.AUDIT_KEY,
        value: String(days),
        category: this.CATEGORY,
      });
    }

    await this.settingRepository.save(setting);
    this.logger.log(`Audit retention days set to ${days}`);
  }
}
