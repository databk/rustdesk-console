import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
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
const DEVICE_CLONE_ISOLATION_KEY = 'general.deviceCloneIsolation';

const DEFAULT_FRONTEND_URL = '';
const DEFAULT_BACKEND_URL = '';
const DEFAULT_RP_NAME = 'RustDesk Console';
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_JWT_EXPIRY_DAYS = 30;
const DEFAULT_AUDIT_RETENTION_DAYS = 0;
const DEFAULT_DEVICE_CLONE_ISOLATION = false;
const FALLBACK_URL = 'http://localhost:3000';

// Refresh the in-memory device-clone-isolation snapshot at most this often so
// multi-replica deployments converge without a restart. The flag changes rarely,
// so a minute-level cadence is enough.
const DEVICE_CLONE_ISOLATION_REFRESH_MS = 60_000;

const ALL_KEYS = [
  WATERMARK_ENABLED_KEY,
  DEFAULT_LANGUAGE_KEY,
  JWT_EXPIRY_DAYS_KEY,
  AUDIT_RETENTION_DAYS_KEY,
  SITE_FRONTEND_URL_KEY,
  SITE_BACKEND_URL_KEY,
  WEBAUTHN_ENABLED_KEY,
  WEBAUTHN_RP_NAME_KEY,
  DEVICE_CLONE_ISOLATION_KEY,
];

@Injectable()
export class GeneralSettingsService implements OnModuleInit {
  private readonly logger = new Logger(GeneralSettingsService.name);
  private deviceCloneIsolationCache = DEFAULT_DEVICE_CLONE_ISOLATION;
  private cacheGeneration = 0;

  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepository: Repository<SystemSetting>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    // Fail fast: if the startup read errors, let module initialization fail
    // instead of silently defaulting to legacy mode.
    const value = await this.readValues([DEVICE_CLONE_ISOLATION_KEY]);
    this.deviceCloneIsolationCache =
      value.get(DEVICE_CLONE_ISOLATION_KEY) === 'true';
  }

  @Interval(DEVICE_CLONE_ISOLATION_REFRESH_MS)
  private async refreshDeviceCloneIsolation(): Promise<void> {
    try {
      const generation = this.cacheGeneration;
      const value = await this.readValues([DEVICE_CLONE_ISOLATION_KEY]);
      // Discard a stale read if a settings update landed while we were reading.
      if (generation !== this.cacheGeneration) return;
      this.deviceCloneIsolationCache =
        value.get(DEVICE_CLONE_ISOLATION_KEY) === 'true';
    } catch (error) {
      this.logger.warn(
        `Unable to refresh device clone isolation setting: ${String(error)}`,
      );
    }
  }

  /**
   * Whether cloned-client isolation is enabled.
   * Reads from an in-memory snapshot refreshed at startup, on settings update,
   * and on a fixed interval so multi-replica deployments converge without a
   * restart. Hot paths (heartbeats) call this synchronously.
   */
  isDeviceCloneIsolationEnabled(): boolean {
    return this.deviceCloneIsolationCache;
  }

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
      deviceCloneIsolation: values.get(DEVICE_CLONE_ISOLATION_KEY) === 'true',
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
   * Get the minimal settings needed for frontend page rendering (publicly readable)
   * Only returns watermarkEnabled / defaultLanguage / webauthnEnabled,
   * Does not expose administrator settings such as the site URLs and rpName
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
   * Get site URL configuration (consumed by modules such as OIDC / User / WebAuthn)
   * - effectiveFrontendUrl: frontendUrl falls back to http://localhost:3000 when not configured
   * - effectiveBackendUrl: backendUrl falls back to frontendUrl when not configured, then to http://localhost:3000
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
   * Get WebAuthn configuration (consumed by WebAuthnConfigService)
   * enabled defaults to true, but when frontendUrl is not configured the caller decides whether to downgrade
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
   * Get the JWT token validity in days (consumed by AuthTokenService)
   * Defaults to 30 days; can be changed via the settings/general endpoint
   */
  async getJwtExpiryDays(): Promise<number> {
    const values = await this.readValues([JWT_EXPIRY_DAYS_KEY]);
    return this.readJwtExpiryDays(values.get(JWT_EXPIRY_DAYS_KEY));
  }

  /**
   * Get the audit log retention in days (consumed by AuditCleanupService)
   * Defaults to 0, meaning no automatic cleanup; can be changed via the settings/general endpoint
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
      auditRetentionDays: dto.auditRetentionDays ?? current.auditRetentionDays,
      deviceCloneIsolation:
        dto.deviceCloneIsolation ?? current.deviceCloneIsolation,
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
      [DEVICE_CLONE_ISOLATION_KEY, String(merged.deviceCloneIsolation)],
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

    this.cacheGeneration += 1;
    this.deviceCloneIsolationCache = merged.deviceCloneIsolation;

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
