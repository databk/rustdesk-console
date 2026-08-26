import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  FrontendSettingsDto,
  GeneralSettingsDto,
  UpdateGeneralSettingsDto,
} from '../dto/general-settings.dto';
import { SystemSetting } from '../entities/system-setting.entity';

const CATEGORY = 'general';
const WATERMARK_ENABLED_KEY = 'general.watermarkEnabled';
const DEFAULT_LANGUAGE_KEY = 'general.defaultLanguage';
const JWT_EXPIRY_DAYS_KEY = 'general.jwtExpiryDays';
const AUDIT_RETENTION_DAYS_KEY = 'general.auditRetentionDays';
const SITE_FRONTEND_URL_KEY = 'general.siteFrontendUrl';
const SITE_BACKEND_URL_KEY = 'general.siteBackendUrl';
const WEBAUTHN_ENABLED_KEY = 'general.webauthnEnabled';
const WEBAUTHN_RP_NAME_KEY = 'general.webauthnRpName';

const DEFAULT_FRONTEND_URL = '';
const DEFAULT_BACKEND_URL = '';
const DEFAULT_RP_NAME = 'RustDesk Console';
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_JWT_EXPIRY_DAYS = 30;
const DEFAULT_AUDIT_RETENTION_DAYS = 0;
const FALLBACK_URL = 'http://localhost:3000';

const ALL_KEYS = [
  WATERMARK_ENABLED_KEY,
  DEFAULT_LANGUAGE_KEY,
  JWT_EXPIRY_DAYS_KEY,
  AUDIT_RETENTION_DAYS_KEY,
  SITE_FRONTEND_URL_KEY,
  SITE_BACKEND_URL_KEY,
  WEBAUTHN_ENABLED_KEY,
  WEBAUTHN_RP_NAME_KEY,
];

@Injectable()
export class GeneralSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepository: Repository<SystemSetting>,
    private readonly dataSource: DataSource,
  ) {}

  async getSettings(): Promise<GeneralSettingsDto> {
    const values = await this.readValues(ALL_KEYS);

    return {
      watermarkEnabled: this.readWatermarkEnabled(
        values.get(WATERMARK_ENABLED_KEY),
      ),
      defaultLanguage: values.get(DEFAULT_LANGUAGE_KEY) ?? DEFAULT_LANGUAGE,
      jwtExpiryDays: this.readJwtExpiryDays(values.get(JWT_EXPIRY_DAYS_KEY)),
      auditRetentionDays: this.readAuditRetentionDays(
        values.get(AUDIT_RETENTION_DAYS_KEY),
      ),
      site: {
        frontendUrl: values.get(SITE_FRONTEND_URL_KEY) ?? DEFAULT_FRONTEND_URL,
        backendUrl: values.get(SITE_BACKEND_URL_KEY) ?? DEFAULT_BACKEND_URL,
      },
      webauthn: {
        enabled: this.readWebAuthnEnabled(values.get(WEBAUTHN_ENABLED_KEY)),
        rpName: values.get(WEBAUTHN_RP_NAME_KEY) ?? DEFAULT_RP_NAME,
      },
    };
  }

  /**
   * 获取前端页面渲染所需的精简配置（公开可读）
   * 仅返回 watermarkEnabled / defaultLanguage / webauthnEnabled，
   * 不暴露站点地址与 rpName 等管理员配置
   */
  async getFrontendSettings(): Promise<FrontendSettingsDto> {
    const settings = await this.getSettings();
    return {
      watermarkEnabled: settings.watermarkEnabled,
      defaultLanguage: settings.defaultLanguage,
      webauthnEnabled: settings.webauthn.enabled,
    };
  }

  /**
   * 获取站点地址配置（供 OIDC / User / WebAuthn 等模块消费）
   * - effectiveFrontendUrl: frontendUrl 未配置时回退到 http://localhost:3000
   * - effectiveBackendUrl: backendUrl 未配置时回退到 frontendUrl，再回退到 http://localhost:3000
   */
  async getSiteSettings(): Promise<{
    frontendUrl: string;
    backendUrl: string;
    effectiveFrontendUrl: string;
    effectiveBackendUrl: string;
  }> {
    const values = await this.readValues([
      SITE_FRONTEND_URL_KEY,
      SITE_BACKEND_URL_KEY,
    ]);
    const frontendUrl =
      values.get(SITE_FRONTEND_URL_KEY) ?? DEFAULT_FRONTEND_URL;
    const backendUrl = values.get(SITE_BACKEND_URL_KEY) ?? DEFAULT_BACKEND_URL;

    return {
      frontendUrl,
      backendUrl,
      effectiveFrontendUrl: frontendUrl || FALLBACK_URL,
      effectiveBackendUrl: backendUrl || frontendUrl || FALLBACK_URL,
    };
  }

  /**
   * 获取 WebAuthn 配置（供 WebAuthnConfigService 消费）
   * enabled 默认 true，但 frontendUrl 未配置时由调用方决定是否降级
   */
  async getWebAuthnSettings(): Promise<{
    enabled: boolean;
    rpName: string;
  }> {
    const values = await this.readValues([
      WEBAUTHN_ENABLED_KEY,
      WEBAUTHN_RP_NAME_KEY,
    ]);
    return {
      enabled: this.readWebAuthnEnabled(values.get(WEBAUTHN_ENABLED_KEY)),
      rpName: values.get(WEBAUTHN_RP_NAME_KEY) ?? DEFAULT_RP_NAME,
    };
  }

  /**
   * 获取 JWT Token 有效期天数（供 AuthTokenService 消费）
   * 默认 30 天，可通过 settings/general 接口修改
   */
  async getJwtExpiryDays(): Promise<number> {
    const values = await this.readValues([JWT_EXPIRY_DAYS_KEY]);
    return this.readJwtExpiryDays(values.get(JWT_EXPIRY_DAYS_KEY));
  }

  /**
   * 获取审计日志保留天数（供 AuditCleanupService 消费）
   * 默认 0 表示不自动清理，可通过 settings/general 接口修改
   */
  async getAuditRetentionDays(): Promise<number> {
    const values = await this.readValues([AUDIT_RETENTION_DAYS_KEY]);
    return this.readAuditRetentionDays(values.get(AUDIT_RETENTION_DAYS_KEY));
  }

  async updateSettings(
    dto: UpdateGeneralSettingsDto,
  ): Promise<GeneralSettingsDto> {
    const current = await this.getSettings();
    const merged: GeneralSettingsDto = {
      watermarkEnabled: dto.watermarkEnabled,
      defaultLanguage: dto.defaultLanguage ?? current.defaultLanguage,
      jwtExpiryDays: dto.jwtExpiryDays ?? current.jwtExpiryDays,
      auditRetentionDays:
        dto.auditRetentionDays ?? current.auditRetentionDays,
      site: {
        frontendUrl: dto.site?.frontendUrl ?? current.site.frontendUrl,
        backendUrl: dto.site?.backendUrl ?? current.site.backendUrl,
      },
      webauthn: {
        enabled: dto.webauthn?.enabled ?? current.webauthn.enabled,
        rpName: dto.webauthn?.rpName ?? current.webauthn.rpName,
      },
    };

    const values = new Map<string, string>([
      [WATERMARK_ENABLED_KEY, String(merged.watermarkEnabled)],
      [DEFAULT_LANGUAGE_KEY, merged.defaultLanguage ?? DEFAULT_LANGUAGE],
      [JWT_EXPIRY_DAYS_KEY, String(merged.jwtExpiryDays)],
      [AUDIT_RETENTION_DAYS_KEY, String(merged.auditRetentionDays)],
      [SITE_FRONTEND_URL_KEY, merged.site.frontendUrl ?? ''],
      [SITE_BACKEND_URL_KEY, merged.site.backendUrl ?? ''],
      [WEBAUTHN_ENABLED_KEY, String(merged.webauthn.enabled)],
      [WEBAUTHN_RP_NAME_KEY, merged.webauthn.rpName ?? DEFAULT_RP_NAME],
    ]);

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SystemSetting);
      const existing = await repository.find({
        where: { key: In(ALL_KEYS) },
      });
      const existingByKey = new Map(existing.map((item) => [item.key, item]));

      const entities = [...values].map(([key, value]) => {
        const setting = existingByKey.get(key) || repository.create({ key });
        setting.value = value;
        setting.category = CATEGORY;
        setting.isSensitive = false;
        return setting;
      });

      await repository.save(entities);
    });

    return merged;
  }

  private async readValues(keys: string[]): Promise<Map<string, string>> {
    const settings = await this.settingRepository.find({
      where: { key: In(keys) },
    });
    return new Map(settings.map((setting) => [setting.key, setting.value]));
  }

  private readWatermarkEnabled(value: string | undefined): boolean {
    if (value === 'false') return false;
    return true;
  }

  private readWebAuthnEnabled(value: string | undefined): boolean {
    if (value === 'false') return false;
    return true;
  }

  private readJwtExpiryDays(value: string | undefined): number {
    const parsed = parseInt(value ?? '', 10);
    if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_JWT_EXPIRY_DAYS;
    return parsed;
  }

  private readAuditRetentionDays(value: string | undefined): number {
    const parsed = parseInt(value ?? '', 10);
    if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_AUDIT_RETENTION_DAYS;
    return parsed;
  }
}
