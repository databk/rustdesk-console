import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  resolveWebClientSettings,
  type ValidatedWebClientConfig,
  type WebClientSettings,
  type WebClientSettingsService,
} from './web-client-settings.service';

export type WebClientConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      idServerUrl: string;
      relayServerUrl: string;
      serverPublicKey: string;
    };

type WebClientState =
  | { kind: 'disabled' }
  | { kind: 'invalid' }
  | { kind: 'enabled'; config: ValidatedWebClientConfig };

// Reads the persisted web client configuration into an in-memory snapshot so
// the WebSocket gateway and session service keep their synchronous contract.
// The snapshot is refreshed at startup and after every settings update; a
// database error keeps the previous snapshot instead of degrading service.
@Injectable()
export class WebClientService implements OnModuleInit {
  private readonly logger = new Logger(WebClientService.name);
  private state: WebClientState = { kind: 'disabled' };

  constructor(private readonly settings: WebClientSettingsService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    let settings: WebClientSettings;
    try {
      settings = await this.settings.getActiveConfig();
    } catch (error) {
      this.logger.warn(`Unable to load web client settings: ${String(error)}`);
      return;
    }
    if (!settings.enabled) {
      this.state = { kind: 'disabled' };
      return;
    }
    try {
      const config = resolveWebClientSettings(settings);
      if (config) this.state = { kind: 'enabled', config };
      else this.state = { kind: 'disabled' };
    } catch {
      this.state = { kind: 'invalid' };
    }
  }

  getConfiguration(): WebClientConfiguration {
    if (this.state.kind === 'invalid') return this.unavailable();
    if (this.state.kind === 'disabled') return { enabled: false };
    const { config } = this.state;
    return {
      enabled: true,
      idServerUrl: config.idServerUrl,
      relayServerUrl: config.relayServerUrl,
      serverPublicKey: config.serverPublicKey,
    };
  }

  getAllowedOrigin(): string {
    this.requireConfiguration();
    if (this.state.kind !== 'enabled') return this.unavailable();
    return this.state.config.allowedOrigin;
  }

  getUpstream(phase: 'rendezvous' | 'relay'): string {
    const configuration = this.requireConfiguration();
    if (this.state.kind !== 'enabled') return this.unavailable();
    const { config } = this.state;
    return phase === 'rendezvous'
      ? (config.idUpstreamUrl ?? configuration.idServerUrl)
      : (config.relayUpstreamUrl ?? configuration.relayServerUrl);
  }

  requireConfiguration(): Extract<WebClientConfiguration, { enabled: true }> {
    const configuration = this.getConfiguration();
    if (!configuration.enabled) return this.unavailable();
    return configuration;
  }

  private unavailable(): never {
    throw new ServiceUnavailableException(
      'Web client configuration is unavailable',
    );
  }
}
