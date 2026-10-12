import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type WebClientConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      idServerUrl: string;
      relayServerUrl: string;
      serverPublicKey: string;
    };

@Injectable()
export class WebClientService {
  constructor(private readonly config: ConfigService) {}

  getConfiguration(): WebClientConfiguration {
    const enabled = this.config.get<string>('WEB_CLIENT_ENABLED');
    if (enabled === undefined || enabled === 'false') return { enabled: false };
    if (enabled !== 'true') return this.unavailable();
    const idServerUrl = this.readUrl('WEB_CLIENT_ID_SERVER_URL', false);
    const relayServerUrl = this.readUrl('WEB_CLIENT_RELAY_SERVER_URL', false);
    const serverPublicKey = this.config.get<string>(
      'WEB_CLIENT_SERVER_PUBLIC_KEY',
    );
    if (typeof serverPublicKey !== 'string') return this.unavailable();
    const decoded = Buffer.from(serverPublicKey, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== serverPublicKey)
      return this.unavailable();
    this.readOrigin();
    this.readUrl('WEB_CLIENT_ID_UPSTREAM_URL', true, idServerUrl);
    this.readUrl('WEB_CLIENT_RELAY_UPSTREAM_URL', true, relayServerUrl);
    return { enabled: true, idServerUrl, relayServerUrl, serverPublicKey };
  }

  getAllowedOrigin(): string {
    this.requireConfiguration();
    return this.readOrigin();
  }

  getUpstream(phase: 'rendezvous' | 'relay'): string {
    const configuration = this.requireConfiguration();
    return phase === 'rendezvous'
      ? this.readUrl(
          'WEB_CLIENT_ID_UPSTREAM_URL',
          true,
          configuration.idServerUrl,
        )
      : this.readUrl(
          'WEB_CLIENT_RELAY_UPSTREAM_URL',
          true,
          configuration.relayServerUrl,
        );
  }

  requireConfiguration(): Extract<WebClientConfiguration, { enabled: true }> {
    const configuration = this.getConfiguration();
    if (!configuration.enabled) return this.unavailable();
    return configuration;
  }

  private readOrigin(): string {
    const value = this.config.get<string>('WEB_CLIENT_ALLOWED_ORIGIN');
    try {
      if (typeof value !== 'string' || /[\s\\?#]/.test(value))
        return this.unavailable();
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.origin !== value
      )
        return this.unavailable();
      return value;
    } catch {
      return this.unavailable();
    }
  }

  private readUrl(name: string, internal: boolean, fallback?: string): string {
    const value = this.config.get<string>(name) ?? fallback;
    if (typeof value !== 'string' || /[\s\\?#]/.test(value))
      return this.unavailable();
    try {
      const url = new URL(value);
      if (
        (!internal && url.protocol !== 'wss:') ||
        (internal && !['ws:', 'wss:'].includes(url.protocol)) ||
        !url.hostname ||
        url.username ||
        url.password ||
        value.split('/')[2].includes('@') ||
        value !== value.trim()
      )
        return this.unavailable();
      return value;
    } catch {
      return this.unavailable();
    }
  }

  private unavailable(): never {
    throw new ServiceUnavailableException(
      'Web client configuration is unavailable',
    );
  }
}
