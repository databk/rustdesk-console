import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { UpdateWebClientSettingsDto } from './dto/web-client-settings.dto';

/** Raw web client settings as stored in the database */
export interface WebClientSettings {
  enabled: boolean;
  idServerUrl?: string;
  relayServerUrl?: string;
  serverPublicKey?: string;
  allowedOrigin?: string;
  idUpstreamUrl?: string;
  relayUpstreamUrl?: string;
}

/** Fully validated web client configuration for internal consumers */
export interface ValidatedWebClientConfig {
  idServerUrl: string;
  relayServerUrl: string;
  serverPublicKey: string;
  allowedOrigin: string;
  idUpstreamUrl?: string;
  relayUpstreamUrl?: string;
}

/** Web client settings projection returned by the settings API */
export interface WebClientSettingsView {
  enabled: boolean;
  idServerUrl: string;
  relayServerUrl: string;
  serverPublicKey: string;
  allowedOrigin: string;
  idUpstreamUrl: string;
  relayUpstreamUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebClientSettingsIssue {
  field: string;
  message: string;
}

export class InvalidWebClientSettingsError extends Error {
  constructor(readonly issues: WebClientSettingsIssue[]) {
    super('Invalid web client settings');
  }
}

const FIELD_LABELS: Record<string, string> = {
  idServerUrl: 'idServerUrl',
  relayServerUrl: 'relayServerUrl',
  serverPublicKey: 'serverPublicKey',
  allowedOrigin: 'allowedOrigin',
  idUpstreamUrl: 'idUpstreamUrl',
  relayUpstreamUrl: 'relayUpstreamUrl',
};

// Strict URL check shared by public and internal endpoints: no whitespace,
// backslashes, queries or fragments, no credentials, and an exact hostname.
function strictUrl(
  value: string | undefined,
  protocols: string[],
  field: string,
): string {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\s\\?#]/.test(value) ||
    value !== value.trim()
  )
    throw issue(field);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw issue(field);
  }
  if (
    !protocols.includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    value.split('/')[2].includes('@')
  )
    throw issue(field);
  return value;
}

function issue(field: string): InvalidWebClientSettingsError {
  return new InvalidWebClientSettingsError([
    { field, message: `Invalid ${FIELD_LABELS[field] ?? field}` },
  ]);
}

/**
 * Validate raw web client settings.
 * Returns null when the web client is disabled.
 * Throws InvalidWebClientSettingsError when it is enabled but misconfigured.
 */
export function resolveWebClientSettings(
  settings: WebClientSettings,
): ValidatedWebClientConfig | null {
  if (!settings.enabled) return null;
  const idServerUrl = strictUrl(settings.idServerUrl, ['wss:'], 'idServerUrl');
  const relayServerUrl = strictUrl(
    settings.relayServerUrl,
    ['wss:'],
    'relayServerUrl',
  );
  const serverPublicKey = settings.serverPublicKey;
  if (typeof serverPublicKey !== 'string' || !serverPublicKey)
    throw issue('serverPublicKey');
  const decoded = Buffer.from(serverPublicKey, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== serverPublicKey)
    throw issue('serverPublicKey');
  const origin = settings.allowedOrigin;
  if (
    typeof origin !== 'string' ||
    !origin ||
    /[\s\\?#]/.test(origin) ||
    origin !== origin.trim()
  )
    throw issue('allowedOrigin');
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw issue('allowedOrigin');
  }
  if (
    parsedOrigin.protocol !== 'https:' ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.origin !== origin
  )
    throw issue('allowedOrigin');
  const idUpstreamUrl = settings.idUpstreamUrl
    ? strictUrl(settings.idUpstreamUrl, ['ws:', 'wss:'], 'idUpstreamUrl')
    : undefined;
  const relayUpstreamUrl = settings.relayUpstreamUrl
    ? strictUrl(settings.relayUpstreamUrl, ['ws:', 'wss:'], 'relayUpstreamUrl')
    : undefined;
  return {
    idServerUrl,
    relayServerUrl,
    serverPublicKey,
    allowedOrigin: origin,
    ...(idUpstreamUrl ? { idUpstreamUrl } : {}),
    ...(relayUpstreamUrl ? { relayUpstreamUrl } : {}),
  };
}

const WEB_CLIENT_ENV = {
  enabled: 'WEB_CLIENT_ENABLED',
  idServerUrl: 'WEB_CLIENT_ID_SERVER_URL',
  relayServerUrl: 'WEB_CLIENT_RELAY_SERVER_URL',
  serverPublicKey: 'WEB_CLIENT_SERVER_PUBLIC_KEY',
  allowedOrigin: 'WEB_CLIENT_ALLOWED_ORIGIN',
  idUpstreamUrl: 'WEB_CLIENT_ID_UPSTREAM_URL',
  relayUpstreamUrl: 'WEB_CLIENT_RELAY_UPSTREAM_URL',
} as const;

/**
 * Web client settings service
 * Manages web client configuration using the generic SystemSetting table,
 * following the SmtpSettingsService pattern.
 *
 * On the first read after an upgrade from environment-variable deployments
 * the previous WEB_CLIENT_* values are imported once into the database so
 * existing deployments keep working without manual reconfiguration.
 */
@Injectable()
export class WebClientSettingsService {
  private readonly logger = new Logger(WebClientSettingsService.name);

  /** Setting category */
  private readonly CATEGORY = 'webClient';

  /** Web client setting keys */
  private readonly KEYS = {
    ENABLED: 'webClient.enabled',
    ID_SERVER_URL: 'webClient.idServerUrl',
    RELAY_SERVER_URL: 'webClient.relayServerUrl',
    SERVER_PUBLIC_KEY: 'webClient.serverPublicKey',
    ALLOWED_ORIGIN: 'webClient.allowedOrigin',
    ID_UPSTREAM_URL: 'webClient.idUpstreamUrl',
    RELAY_UPSTREAM_URL: 'webClient.relayUpstreamUrl',
  } as const;

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * Get raw web client settings (for internal service use)
   */
  async getActiveConfig(): Promise<WebClientSettings> {
    const settings = await this.getSettingsMap();
    if (settings.size === 0) {
      const imported = await this.importFromEnvironment();
      if (imported) return imported;
    }
    return this.parseSettings(settings);
  }

  /**
   * Get web client settings (for API responses)
   * Throws NotFoundException if the configuration does not exist
   */
  async getSettings(): Promise<WebClientSettingsView> {
    const settings = await this.getSettingsMap();
    if (!settings.has(this.KEYS.ENABLED))
      throw new NotFoundException('Web client configuration does not exist');
    const anySetting = await this.settingRepository.findOne({
      where: { key: this.KEYS.ENABLED },
    });
    const parsed = this.parseSettings(settings);
    return {
      enabled: parsed.enabled,
      idServerUrl: parsed.idServerUrl ?? '',
      relayServerUrl: parsed.relayServerUrl ?? '',
      serverPublicKey: parsed.serverPublicKey ?? '',
      allowedOrigin: parsed.allowedOrigin ?? '',
      idUpstreamUrl: parsed.idUpstreamUrl ?? '',
      relayUpstreamUrl: parsed.relayUpstreamUrl ?? '',
      createdAt: anySetting?.createdAt || new Date(),
      updatedAt: anySetting?.updatedAt || new Date(),
    };
  }

  /**
   * Update web client settings (Upsert semantics)
   * Only updates the provided fields; when the merged configuration is
   * enabled it must be fully valid before anything is persisted
   */
  async updateSettings(
    dto: UpdateWebClientSettingsDto,
  ): Promise<WebClientSettingsView> {
    const current = this.parseSettings(await this.getSettingsMap());
    const merged: WebClientSettings = {
      enabled: dto.enabled ?? current.enabled,
      idServerUrl: dto.idServerUrl ?? current.idServerUrl,
      relayServerUrl: dto.relayServerUrl ?? current.relayServerUrl,
      serverPublicKey: dto.serverPublicKey ?? current.serverPublicKey,
      allowedOrigin: dto.allowedOrigin ?? current.allowedOrigin,
      idUpstreamUrl: dto.idUpstreamUrl ?? current.idUpstreamUrl,
      relayUpstreamUrl: dto.relayUpstreamUrl ?? current.relayUpstreamUrl,
    };
    if (merged.enabled) {
      try {
        resolveWebClientSettings(merged);
      } catch (error) {
        if (error instanceof InvalidWebClientSettingsError)
          throw new BadRequestException({
            message: 'Invalid web client configuration',
            issues: error.issues,
          });
        throw error;
      }
    }
    const updates: Record<string, string> = {};
    if (dto.enabled !== undefined)
      updates[this.KEYS.ENABLED] = String(dto.enabled);
    if (dto.idServerUrl !== undefined)
      updates[this.KEYS.ID_SERVER_URL] = dto.idServerUrl;
    if (dto.relayServerUrl !== undefined)
      updates[this.KEYS.RELAY_SERVER_URL] = dto.relayServerUrl;
    if (dto.serverPublicKey !== undefined)
      updates[this.KEYS.SERVER_PUBLIC_KEY] = dto.serverPublicKey;
    if (dto.allowedOrigin !== undefined)
      updates[this.KEYS.ALLOWED_ORIGIN] = dto.allowedOrigin;
    if (dto.idUpstreamUrl !== undefined)
      updates[this.KEYS.ID_UPSTREAM_URL] = dto.idUpstreamUrl;
    if (dto.relayUpstreamUrl !== undefined)
      updates[this.KEYS.RELAY_UPSTREAM_URL] = dto.relayUpstreamUrl;
    if (Object.keys(updates).length > 0)
      await this.setMultipleSettings(updates);
    this.logger.log('Web client configuration updated');
    return this.getSettings();
  }

  private parseSettings(map: Map<string, string>): WebClientSettings {
    return {
      enabled: map.get(this.KEYS.ENABLED) === 'true',
      idServerUrl: map.get(this.KEYS.ID_SERVER_URL) || undefined,
      relayServerUrl: map.get(this.KEYS.RELAY_SERVER_URL) || undefined,
      serverPublicKey: map.get(this.KEYS.SERVER_PUBLIC_KEY) || undefined,
      allowedOrigin: map.get(this.KEYS.ALLOWED_ORIGIN) || undefined,
      idUpstreamUrl: map.get(this.KEYS.ID_UPSTREAM_URL) || undefined,
      relayUpstreamUrl: map.get(this.KEYS.RELAY_UPSTREAM_URL) || undefined,
    };
  }

  /**
   * One-time import of the legacy WEB_CLIENT_* environment variables
   * Returns the imported settings, or null when no variable is present
   */
  private async importFromEnvironment(): Promise<WebClientSettings | null> {
    const raw = {
      enabled: process.env[WEB_CLIENT_ENV.enabled],
      idServerUrl: process.env[WEB_CLIENT_ENV.idServerUrl],
      relayServerUrl: process.env[WEB_CLIENT_ENV.relayServerUrl],
      serverPublicKey: process.env[WEB_CLIENT_ENV.serverPublicKey],
      allowedOrigin: process.env[WEB_CLIENT_ENV.allowedOrigin],
      idUpstreamUrl: process.env[WEB_CLIENT_ENV.idUpstreamUrl],
      relayUpstreamUrl: process.env[WEB_CLIENT_ENV.relayUpstreamUrl],
    };
    if (
      !Object.values(raw).some((value) => value !== undefined && value !== '')
    )
      return null;
    const settings: WebClientSettings = {
      enabled: raw.enabled === 'true',
      idServerUrl: raw.idServerUrl || undefined,
      relayServerUrl: raw.relayServerUrl || undefined,
      serverPublicKey: raw.serverPublicKey || undefined,
      allowedOrigin: raw.allowedOrigin || undefined,
      idUpstreamUrl: raw.idUpstreamUrl || undefined,
      relayUpstreamUrl: raw.relayUpstreamUrl || undefined,
    };
    await this.setMultipleSettings({
      [this.KEYS.ENABLED]: String(settings.enabled),
      [this.KEYS.ID_SERVER_URL]: settings.idServerUrl ?? '',
      [this.KEYS.RELAY_SERVER_URL]: settings.relayServerUrl ?? '',
      [this.KEYS.SERVER_PUBLIC_KEY]: settings.serverPublicKey ?? '',
      [this.KEYS.ALLOWED_ORIGIN]: settings.allowedOrigin ?? '',
      [this.KEYS.ID_UPSTREAM_URL]: settings.idUpstreamUrl ?? '',
      [this.KEYS.RELAY_UPSTREAM_URL]: settings.relayUpstreamUrl ?? '',
    });
    this.logger.log(
      'Imported web client configuration from environment variables; manage it in the console settings from now on',
    );
    return settings;
  }

  private async getSettingsMap(): Promise<Map<string, string>> {
    const settings = await this.settingRepository.find({
      where: { category: this.CATEGORY },
    });
    const map = new Map<string, string>();
    for (const setting of settings) map.set(setting.key, setting.value);
    return map;
  }

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
          description: `Web client setting ${key}`,
        });
      }
      await this.settingRepository.save(setting);
    }
  }
}
