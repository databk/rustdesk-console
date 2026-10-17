import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { UpdateServerManagementSettingsDto } from './dto/server-management-settings.dto';

/** Effective server management configuration for internal consumers */
export interface ServerManagementRuntimeConfig {
  /** Validated hbbs management API origin; undefined when disabled */
  url?: string;
  token: string;
  nodeId: string;
  nodeName: string;
}

/** Server management settings projection returned by the settings API */
export interface ServerManagementSettingsView {
  /** Raw stored url (kept visible so administrators can fix invalid values) */
  url: string;
  token: string;
  nodeId: string;
  nodeName: string;
  configured: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_NODE_ID = 'rustdesk';
export const DEFAULT_NODE_NAME = 'RustDesk';
const NODE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const SERVER_MANAGEMENT_ENV = {
  url: 'HBBS_MANAGEMENT_URL',
  token: 'SERVER_MANAGEMENT_TOKEN',
  nodeId: 'SERVER_MANAGEMENT_NODE_ID',
  nodeName: 'SERVER_MANAGEMENT_NODE_NAME',
} as const;

// Accepts an exact HTTP(S) origin only: no credentials, path, query or
// fragment. Returns undefined for empty or invalid values.
function parseOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/' || url.pathname === '')
    )
      return url.origin;
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Server management settings service
 * Manages the hbbs management connection using the generic SystemSetting
 * table, following the SmtpSettingsService pattern.
 *
 * On the first read after an upgrade from environment-variable deployments
 * the previous HBBS_MANAGEMENT_URL / SERVER_MANAGEMENT_* values are imported
 * once into the database so existing deployments keep working.
 */
@Injectable()
export class ServerManagementSettingsService {
  private readonly logger = new Logger(ServerManagementSettingsService.name);

  /** Setting category */
  private readonly CATEGORY = 'serverManagement';

  /** Token masking placeholder */
  private readonly TOKEN_MASK = '******';

  /** Server management setting keys */
  private readonly KEYS = {
    URL: 'serverManagement.url',
    TOKEN: 'serverManagement.token',
    NODE_ID: 'serverManagement.nodeId',
    NODE_NAME: 'serverManagement.nodeName',
  } as const;

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * Get the effective runtime configuration (for internal service use)
   * Invalid values are tolerated and fall back to safe defaults so a broken
   * row never takes the whole module down; administrators see and fix the
   * raw values through the settings API.
   */
  async getActiveConfig(): Promise<ServerManagementRuntimeConfig> {
    let map = await this.getSettingsMap();
    if (map.size === 0) {
      const imported = await this.importFromEnvironment();
      if (imported) map = imported;
    }
    const url = parseOrigin(map.get(this.KEYS.URL));
    if (map.get(this.KEYS.URL) && !url)
      this.logger.warn(
        'Stored server management url is not a valid HTTP(S) origin; server management is disabled',
      );
    let nodeId = map.get(this.KEYS.NODE_ID) || DEFAULT_NODE_ID;
    if (!NODE_ID_PATTERN.test(nodeId)) {
      this.logger.warn(
        'Stored server management nodeId is invalid; using default',
      );
      nodeId = DEFAULT_NODE_ID;
    }
    return {
      url,
      token: map.get(this.KEYS.TOKEN) || '',
      nodeId,
      nodeName: map.get(this.KEYS.NODE_NAME) || DEFAULT_NODE_NAME,
    };
  }

  /**
   * Get server management settings (for API responses, token masked)
   */
  async getSettings(): Promise<ServerManagementSettingsView> {
    const map = await this.getSettingsMap();
    if (map.size === 0)
      return {
        url: '',
        token: '',
        nodeId: DEFAULT_NODE_ID,
        nodeName: DEFAULT_NODE_NAME,
        configured: false,
      };
    const anySetting = await this.settingRepository.findOne({
      where: { key: this.KEYS.URL },
    });
    const token = map.get(this.KEYS.TOKEN) || '';
    return {
      url: map.get(this.KEYS.URL) || '',
      token: token ? this.TOKEN_MASK : '',
      nodeId: map.get(this.KEYS.NODE_ID) || DEFAULT_NODE_ID,
      nodeName: map.get(this.KEYS.NODE_NAME) || DEFAULT_NODE_NAME,
      configured: true,
      createdAt: anySetting?.createdAt,
      updatedAt: anySetting?.updatedAt,
    };
  }

  /**
   * Update server management settings (Upsert semantics)
   * Only updates the provided fields; a set url requires a token of at
   * least 32 characters and a valid nodeId
   */
  async updateSettings(
    dto: UpdateServerManagementSettingsDto,
  ): Promise<ServerManagementSettingsView> {
    const map = await this.getSettingsMap();
    const url =
      dto.url !== undefined ? dto.url.trim() : map.get(this.KEYS.URL) || '';
    const token =
      dto.token !== undefined && dto.token !== this.TOKEN_MASK
        ? dto.token
        : map.get(this.KEYS.TOKEN) || '';
    const nodeId =
      dto.nodeId !== undefined
        ? dto.nodeId
        : map.get(this.KEYS.NODE_ID) || DEFAULT_NODE_ID;
    const nodeName =
      dto.nodeName !== undefined
        ? dto.nodeName
        : map.get(this.KEYS.NODE_NAME) || DEFAULT_NODE_NAME;
    if (url && !parseOrigin(url))
      throw new BadRequestException('url must be an HTTP(S) origin');
    if (url && token.length < 32)
      throw new BadRequestException(
        'token must contain at least 32 characters when url is set',
      );
    if (!NODE_ID_PATTERN.test(nodeId))
      throw new BadRequestException('nodeId must match ^[a-zA-Z0-9_-]{1,64}$');
    if (typeof nodeName !== 'string' || !nodeName.trim())
      throw new BadRequestException('nodeName must be a non-empty string');
    const updates: Record<string, string> = {};
    if (dto.url !== undefined) updates[this.KEYS.URL] = url;
    if (dto.token !== undefined && dto.token !== this.TOKEN_MASK)
      updates[this.KEYS.TOKEN] = dto.token;
    if (dto.nodeId !== undefined) updates[this.KEYS.NODE_ID] = nodeId;
    if (dto.nodeName !== undefined)
      updates[this.KEYS.NODE_NAME] = nodeName.trim();
    if (Object.keys(updates).length > 0)
      await this.setMultipleSettings(updates);
    this.logger.log('Server management configuration updated');
    return this.getSettings();
  }

  /**
   * One-time import of the legacy environment variables
   * Returns the imported settings map, or null when no variable is present
   */
  private async importFromEnvironment(): Promise<Map<string, string> | null> {
    const raw = {
      url: process.env[SERVER_MANAGEMENT_ENV.url],
      token: process.env[SERVER_MANAGEMENT_ENV.token],
      nodeId: process.env[SERVER_MANAGEMENT_ENV.nodeId],
      nodeName: process.env[SERVER_MANAGEMENT_ENV.nodeName],
    };
    if (
      !Object.values(raw).some((value) => value !== undefined && value !== '')
    )
      return null;
    const data: Record<string, string> = {
      [this.KEYS.URL]: raw.url ?? '',
      [this.KEYS.TOKEN]: raw.token ?? '',
      [this.KEYS.NODE_ID]: raw.nodeId ?? '',
      [this.KEYS.NODE_NAME]: raw.nodeName ?? '',
    };
    await this.setMultipleSettings(data);
    this.logger.log(
      'Imported server management configuration from environment variables; manage it in the console settings from now on',
    );
    const map = new Map(Object.entries(data));
    return map;
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
          isSensitive: key === this.KEYS.TOKEN,
        });
      }
      await this.settingRepository.save(setting);
    }
  }
}
