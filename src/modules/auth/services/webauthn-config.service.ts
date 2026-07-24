import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../../settings/entities/system-setting.entity';

const RP_ID_KEY = 'webauthn.rpId';
const RP_NAME_KEY = 'webauthn.rpName';
const RP_ORIGINS_KEY = 'webauthn.rpOrigins';
const ENABLED_KEY = 'webauthn.enabled';

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  rpOrigins: string[];
  enabled: boolean;
}

/**
 * WebAuthn 配置服务
 * 从 system_settings 表读取 RP 配置，支持环境变量回退
 *
 * 管理员配置接口由后续单独实现，当前通过环境变量或直接写入数据库配置
 */
@Injectable()
export class WebAuthnConfigService {
  private readonly logger = new Logger(WebAuthnConfigService.name);
  private cachedConfig: WebAuthnConfig | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepository: Repository<SystemSetting>,
  ) {}

  /**
   * 获取 WebAuthn RP 配置
   * 优先从数据库读取，未配置时回退到环境变量
   */
  async getConfig(): Promise<WebAuthnConfig> {
    if (
      this.cachedConfig &&
      Date.now() - this.lastCacheTime < this.CACHE_TTL_MS
    ) {
      return this.cachedConfig;
    }

    const settings = await this.settingRepository.find({
      where: {
        key: [RP_ID_KEY, RP_NAME_KEY, RP_ORIGINS_KEY, ENABLED_KEY] as never,
      },
    });
    const values = new Map(settings.map((s) => [s.key, s.value]));

    const rpId =
      values.get(RP_ID_KEY) || process.env.WEBAUTHN_RP_ID || 'localhost';

    const rpName =
      values.get(RP_NAME_KEY) ||
      process.env.WEBAUTHN_RP_NAME ||
      'RustDesk Console';

    const rpOriginsStr =
      values.get(RP_ORIGINS_KEY) ||
      process.env.WEBAUTHN_RP_ORIGINS ||
      'http://localhost:3000';
    const rpOrigins = rpOriginsStr.startsWith('[')
      ? (JSON.parse(rpOriginsStr) as string[])
      : rpOriginsStr.split(',').map((s) => s.trim());

    const enabledStr =
      values.get(ENABLED_KEY) || process.env.WEBAUTHN_ENABLED || 'false';
    const enabled = enabledStr === 'true';

    this.cachedConfig = { rpId, rpName, rpOrigins, enabled };
    this.lastCacheTime = Date.now();

    return this.cachedConfig;
  }

  /**
   * 检查 WebAuthn 是否已启用
   */
  async isEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.enabled;
  }

  /**
   * 使配置缓存失效
   * 管理员更新配置后调用
   */
  invalidateCache(): void {
    this.cachedConfig = null;
    this.lastCacheTime = 0;
  }
}
