import { Injectable, Logger } from '@nestjs/common';
import { GeneralSettingsService } from '../../settings/services/general-settings.service';

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  rpOrigins: string[];
  enabled: boolean;
}

/**
 * WebAuthn configuration service
 * Reads the site URL and WebAuthn toggle from general settings and derives the RP configuration
 *
 * - rpId / rpOrigins derived automatically from site.frontendUrl
 * - enabled defaults to true, but falls back to false with a warning when site.frontendUrl is not configured
 */
@Injectable()
export class WebAuthnConfigService {
  private readonly logger = new Logger(WebAuthnConfigService.name);
  private cachedConfig: WebAuthnConfig | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    private readonly generalSettingsService: GeneralSettingsService,
  ) {}

  /**
   * Get the WebAuthn RP configuration
   */
  async getConfig(): Promise<WebAuthnConfig> {
    if (
      this.cachedConfig &&
      Date.now() - this.lastCacheTime < this.CACHE_TTL_MS
    ) {
      return this.cachedConfig;
    }

    const site = await this.generalSettingsService.getSiteSettings();
    const webauthn = await this.generalSettingsService.getWebAuthnSettings();

    const frontendUrl = site.frontendUrl;
    const { rpId, rpOrigins } = this.deriveRpFromFrontendUrl(frontendUrl);

    let enabled = webauthn.enabled;
    if (enabled && !frontendUrl) {
      this.logger.warn(
        'WebAuthn is enabled but site.frontendUrl is not configured. Disabling WebAuthn until the frontend URL is set in general settings.',
      );
      enabled = false;
    }

    this.cachedConfig = {
      rpId,
      rpName: webauthn.rpName,
      rpOrigins,
      enabled,
    };
    this.lastCacheTime = Date.now();

    return this.cachedConfig;
  }

  /**
   * Check whether WebAuthn is enabled
   */
  async isEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.enabled;
  }

  /**
   * Invalidate the configuration cache
   * Called after an administrator updates the configuration
   */
  invalidateCache(): void {
    this.cachedConfig = null;
    this.lastCacheTime = 0;
  }

  private deriveRpFromFrontendUrl(frontendUrl: string): {
    rpId: string;
    rpOrigins: string[];
  } {
    if (!frontendUrl) {
      return { rpId: 'localhost', rpOrigins: ['http://localhost:3000'] };
    }

    try {
      const url = new URL(frontendUrl);
      return { rpId: url.hostname, rpOrigins: [url.origin] };
    } catch {
      this.logger.warn(
        `Failed to parse site.frontendUrl "${frontendUrl}" as URL, falling back to localhost for WebAuthn RP.`,
      );
      return { rpId: 'localhost', rpOrigins: ['http://localhost:3000'] };
    }
  }
}
