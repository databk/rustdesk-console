import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { UpdateLdapConfigDto } from './dto/ldap-config.dto';

/**
 * LDAP 配置接口
 * 定义 LDAP 服务的完整配置结构
 */
export interface LdapConfig {
  /** LDAP 服务器 URL 列表 */
  urls: string[];
  /** 服务账号绑定 DN */
  bindDN: string;
  /** 服务账号密码 */
  bindCredentials: string;
  /** 搜索基础 DN */
  searchBase: string;
  /** 搜索过滤器 */
  searchFilter: string;
  /** 要读取的用户属性列表 */
  searchAttributes: string[];
  /** 组搜索基础 DN */
  groupSearchBase: string;
  /** 组搜索过滤器 */
  groupSearchFilter: string;
  /** 映射为管理员的 LDAP 组 DN 列表 */
  adminGroups: string[];
  /** TLS 配置 */
  tlsOptions: Record<string, any>;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * LDAP 配置服务
 * 使用通用 SystemSetting 表管理 LDAP 配置，遵循 SmtpSettingsService 模式
 */
@Injectable()
export class LdapSettingsService {
  private readonly logger = new Logger(LdapSettingsService.name);

  /** 设置分类 */
  private readonly CATEGORY = 'ldap';

  /** 密码脱敏占位符 */
  private readonly PASS_MASK = '******';

  /** LDAP 设置键名 */
  private readonly LDAP_KEYS = {
    URLS: 'ldap.urls',
    BIND_DN: 'ldap.bindDN',
    BIND_CREDENTIALS: 'ldap.bindCredentials',
    SEARCH_BASE: 'ldap.searchBase',
    SEARCH_FILTER: 'ldap.searchFilter',
    SEARCH_ATTRIBUTES: 'ldap.searchAttributes',
    GROUP_SEARCH_BASE: 'ldap.groupSearchBase',
    GROUP_SEARCH_FILTER: 'ldap.groupSearchFilter',
    ADMIN_GROUPS: 'ldap.adminGroups',
    TLS_OPTIONS: 'ldap.tlsOptions',
    ENABLED: 'ldap.enabled',
  } as const;

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * 获取 LDAP 配置（含密码，供内部服务使用）
   */
  async getActiveConfig(): Promise<LdapConfig | null> {
    const settings = await this.getLdapSettings();

    if (!settings.get(this.LDAP_KEYS.URLS)) {
      return null;
    }

    return this.parseConfig(settings);
  }

  /**
   * 获取 LDAP 配置（密码脱敏，供 API 返回）
   */
  async getLdapConfig(): Promise<
    LdapConfig & { createdAt: Date; updatedAt: Date }
  > {
    const settings = await this.getLdapSettings();

    if (!settings.get(this.LDAP_KEYS.URLS)) {
      throw new NotFoundException('LDAP 配置不存在');
    }

    const anySetting = await this.settingRepository.findOne({
      where: { key: this.LDAP_KEYS.URLS },
    });

    return {
      ...this.parseConfig(settings),
      bindCredentials: this.PASS_MASK,
      createdAt: anySetting?.createdAt || new Date(),
      updatedAt: anySetting?.updatedAt || new Date(),
    };
  }

  /**
   * 更新 LDAP 配置（Upsert 语义）
   */
  async updateLdapConfig(
    dto: UpdateLdapConfigDto,
  ): Promise<LdapConfig & { createdAt: Date; updatedAt: Date }> {
    const existing = await this.settingRepository.findOne({
      where: { key: this.LDAP_KEYS.URLS },
    });

    if (!existing) {
      await this.setMultipleSettings({
        [this.LDAP_KEYS.URLS]: JSON.stringify(dto.urls || []),
        [this.LDAP_KEYS.BIND_DN]: dto.bindDN || '',
        [this.LDAP_KEYS.BIND_CREDENTIALS]: dto.bindCredentials || '',
        [this.LDAP_KEYS.SEARCH_BASE]: dto.searchBase || '',
        [this.LDAP_KEYS.SEARCH_FILTER]:
          dto.searchFilter || '(sAMAccountName={{username}})',
        [this.LDAP_KEYS.SEARCH_ATTRIBUTES]: JSON.stringify(
          dto.searchAttributes || [
            'dn',
            'sAMAccountName',
            'mail',
            'displayName',
          ],
        ),
        [this.LDAP_KEYS.GROUP_SEARCH_BASE]: dto.groupSearchBase || '',
        [this.LDAP_KEYS.GROUP_SEARCH_FILTER]:
          dto.groupSearchFilter || '(member={{dn}})',
        [this.LDAP_KEYS.ADMIN_GROUPS]: JSON.stringify(dto.adminGroups || []),
        [this.LDAP_KEYS.TLS_OPTIONS]: JSON.stringify(dto.tlsOptions || {}),
        [this.LDAP_KEYS.ENABLED]: String(dto.enabled ?? false),
      });
      this.logger.log('LDAP 配置已创建');
    } else {
      const updates: Record<string, string> = {};

      if (dto.urls !== undefined)
        updates[this.LDAP_KEYS.URLS] = JSON.stringify(dto.urls);
      if (dto.bindDN !== undefined)
        updates[this.LDAP_KEYS.BIND_DN] = dto.bindDN;
      if (dto.searchBase !== undefined)
        updates[this.LDAP_KEYS.SEARCH_BASE] = dto.searchBase;
      if (dto.searchFilter !== undefined)
        updates[this.LDAP_KEYS.SEARCH_FILTER] = dto.searchFilter;
      if (dto.searchAttributes !== undefined)
        updates[this.LDAP_KEYS.SEARCH_ATTRIBUTES] = JSON.stringify(
          dto.searchAttributes,
        );
      if (dto.groupSearchBase !== undefined)
        updates[this.LDAP_KEYS.GROUP_SEARCH_BASE] = dto.groupSearchBase;
      if (dto.groupSearchFilter !== undefined)
        updates[this.LDAP_KEYS.GROUP_SEARCH_FILTER] = dto.groupSearchFilter;
      if (dto.adminGroups !== undefined)
        updates[this.LDAP_KEYS.ADMIN_GROUPS] = JSON.stringify(dto.adminGroups);
      if (dto.tlsOptions !== undefined)
        updates[this.LDAP_KEYS.TLS_OPTIONS] = JSON.stringify(dto.tlsOptions);
      if (dto.enabled !== undefined)
        updates[this.LDAP_KEYS.ENABLED] = String(dto.enabled);
      if (
        dto.bindCredentials !== undefined &&
        dto.bindCredentials !== this.PASS_MASK
      ) {
        updates[this.LDAP_KEYS.BIND_CREDENTIALS] = dto.bindCredentials;
      }

      if (Object.keys(updates).length > 0) {
        await this.setMultipleSettings(updates);
      }
      this.logger.log('LDAP 配置已更新');
    }

    return this.getLdapConfig();
  }

  /**
   * 检查 LDAP 是否已启用
   */
  async isEnabled(): Promise<boolean> {
    const config = await this.getActiveConfig();
    return config !== null && config.enabled;
  }

  /**
   * 解析配置 Map 为 LdapConfig 对象
   */
  private parseConfig(settings: Map<string, string>): LdapConfig {
    return {
      urls: this.parseJson<string[]>(settings, this.LDAP_KEYS.URLS, []),
      bindDN: settings.get(this.LDAP_KEYS.BIND_DN) || '',
      bindCredentials: settings.get(this.LDAP_KEYS.BIND_CREDENTIALS) || '',
      searchBase: settings.get(this.LDAP_KEYS.SEARCH_BASE) || '',
      searchFilter:
        settings.get(this.LDAP_KEYS.SEARCH_FILTER) ||
        '(sAMAccountName={{username}})',
      searchAttributes: this.parseJson<string[]>(
        settings,
        this.LDAP_KEYS.SEARCH_ATTRIBUTES,
        ['dn', 'sAMAccountName', 'mail', 'displayName'],
      ),
      groupSearchBase: settings.get(this.LDAP_KEYS.GROUP_SEARCH_BASE) || '',
      groupSearchFilter:
        settings.get(this.LDAP_KEYS.GROUP_SEARCH_FILTER) || '(member={{dn}})',
      adminGroups: this.parseJson<string[]>(
        settings,
        this.LDAP_KEYS.ADMIN_GROUPS,
        [],
      ),
      tlsOptions: this.parseJson<Record<string, any>>(
        settings,
        this.LDAP_KEYS.TLS_OPTIONS,
        {},
      ),
      enabled: settings.get(this.LDAP_KEYS.ENABLED) === 'true',
    };
  }

  /**
   * 解析 JSON 格式的设置项
   */
  private parseJson<T>(
    settings: Map<string, string>,
    key: string,
    defaultValue: T,
  ): T {
    const value = settings.get(key);
    if (!value) return defaultValue;
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }

  /**
   * 获取所有 LDAP 设置
   */
  private async getLdapSettings(): Promise<Map<string, string>> {
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
          isSensitive: key === this.LDAP_KEYS.BIND_CREDENTIALS,
        });
      }

      await this.settingRepository.save(setting);
    }
  }
}
