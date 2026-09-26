import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { UpdateLdapConfigDto, TlsOptionsDto } from './dto/ldap-config.dto';

/**
 * LDAP configuration interface
 * Defines the complete configuration structure of the LDAP service
 */
export interface LdapConfig {
  /** List of LDAP server URLs */
  urls: string[];
  /** Service account bind DN */
  bindDN: string;
  /** Service account password */
  bindCredentials: string;
  /** Search base DN */
  searchBase: string;
  /** Search filter */
  searchFilter: string;
  /** List of user attributes to read */
  searchAttributes: string[];
  /** Group search base DN */
  groupSearchBase: string;
  /** Group search filter */
  groupSearchFilter: string;
  /** List of LDAP group DNs mapped to administrators */
  adminGroups: string[];
  /** TLS configuration */
  tlsOptions: TlsOptionsDto;
  /** Whether enabled */
  enabled: boolean;
}

/**
 * LDAP configuration service
 * Manages LDAP configuration using the generic SystemSetting table, following the SmtpSettingsService pattern
 */
@Injectable()
export class LdapSettingsService {
  private readonly logger = new Logger(LdapSettingsService.name);

  /** Setting category */
  private readonly CATEGORY = 'ldap';

  /** Password masking placeholder */
  private readonly PASS_MASK = '******';

  /** LDAP setting keys */
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
   * Get LDAP configuration (including password, for internal service use)
   */
  async getActiveConfig(): Promise<LdapConfig | null> {
    const settings = await this.getLdapSettings();

    if (!settings.get(this.LDAP_KEYS.URLS)) {
      return null;
    }

    return this.parseConfig(settings);
  }

  /**
   * Get LDAP configuration (password masked, for API responses)
   */
  async getLdapConfig(): Promise<
    LdapConfig & { createdAt: Date; updatedAt: Date }
  > {
    const settings = await this.getLdapSettings();

    if (!settings.get(this.LDAP_KEYS.URLS)) {
      throw new NotFoundException('LDAP configuration does not exist');
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
   * Update LDAP configuration (Upsert semantics)
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
      this.logger.log('LDAP configuration created');
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
      this.logger.log('LDAP configuration updated');
    }

    return this.getLdapConfig();
  }

  /**
   * Check whether LDAP is enabled
   */
  async isEnabled(): Promise<boolean> {
    const config = await this.getActiveConfig();
    return config !== null && config.enabled;
  }

  /**
   * Parse the configuration Map into an LdapConfig object
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
      tlsOptions: this.parseJson<TlsOptionsDto>(
        settings,
        this.LDAP_KEYS.TLS_OPTIONS,
        {},
      ),
      enabled: settings.get(this.LDAP_KEYS.ENABLED) === 'true',
    };
  }

  /**
   * Parse JSON-formatted settings
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
   * Get all LDAP settings
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
          isSensitive: key === this.LDAP_KEYS.BIND_CREDENTIALS,
        });
      }

      await this.settingRepository.save(setting);
    }
  }
}
