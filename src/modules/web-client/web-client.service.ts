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

    const idServerUrl = this.readUrl('WEB_CLIENT_ID_SERVER_URL');
    const relayServerUrl = this.readUrl('WEB_CLIENT_RELAY_SERVER_URL');
    const serverPublicKey = this.config.get<string>(
      'WEB_CLIENT_SERVER_PUBLIC_KEY',
    );
    if (typeof serverPublicKey !== 'string') return this.unavailable();
    const decoded = Buffer.from(serverPublicKey, 'base64');
    if (
      decoded.length !== 32 ||
      decoded.toString('base64') !== serverPublicKey
    ) {
      return this.unavailable();
    }
    return { enabled: true, idServerUrl, relayServerUrl, serverPublicKey };
  }

  private readUrl(name: string): string {
    const value = this.config.get<string>(name);
    if (
      typeof value !== 'string' ||
      !value.startsWith('wss://') ||
      /[\s\\?#]/.test(value)
    ) {
      return this.unavailable();
    }
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'wss:' ||
        !url.hostname ||
        url.username ||
        url.password ||
        value.split('/')[2].includes('@')
      )
        return this.unavailable();
      return value;
    } catch {
      return this.unavailable();
    }
  }

  private unavailable(): never {
    // 不返回原始环境变量或底层 URL 解析异常。
    throw new ServiceUnavailableException(
      'Web client configuration is unavailable',
    );
  }
}
