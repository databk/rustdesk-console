import { ServiceUnavailableException } from '@nestjs/common';
import { WebClientService } from './web-client.service';
import type {
  WebClientSettings,
  WebClientSettingsService,
} from './web-client-settings.service';

describe('网页远控配置边界', () => {
  const valid: WebClientSettings = {
    enabled: true,
    allowedOrigin: 'https://console.example.com:8443',
    idServerUrl: 'wss://console.example.com/ws/id',
    relayServerUrl: 'wss://console.example.com/ws/relay',
    serverPublicKey: Buffer.alloc(32, 7).toString('base64'),
  };
  const service = async (
    settings: WebClientSettings,
    overrides: Partial<WebClientSettingsService> = {},
  ) => {
    const instance = new WebClientService({
      getActiveConfig: () => settings,
      ...overrides,
    } as unknown as WebClientSettingsService);
    await instance.onModuleInit();
    return instance;
  };

  it('关闭时不读取其它错误配置', async () => {
    const instance = await service({
      enabled: false,
      allowedOrigin: 'invalid-secret-origin',
      idUpstreamUrl: 'ws://user:secret@internal',
    });
    expect(instance.getConfiguration()).toEqual({ enabled: false });
    expect(() => instance.requireConfiguration()).toThrow(
      ServiceUnavailableException,
    );
    expect(() => instance.getAllowedOrigin()).toThrow(
      ServiceUnavailableException,
    );
    expect(() => instance.getUpstream('relay')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('公开投影只有三个公开配置，固定内部端点仅供网关使用', async () => {
    const instance = await service({
      ...valid,
      idUpstreamUrl: 'ws://hbbs:21118/internal-id',
      relayUpstreamUrl: 'wss://hbbr:21119/internal-relay',
    });
    expect(instance.getConfiguration()).toEqual({
      enabled: true,
      idServerUrl: valid.idServerUrl,
      relayServerUrl: valid.relayServerUrl,
      serverPublicKey: valid.serverPublicKey,
    });
    expect(instance.getAllowedOrigin()).toBe(valid.allowedOrigin);
    expect(instance.getUpstream('rendezvous')).toBe(
      'ws://hbbs:21118/internal-id',
    );
    expect(instance.getUpstream('relay')).toBe(
      'wss://hbbr:21119/internal-relay',
    );
    const fallback = await service(valid);
    expect(fallback.getUpstream('rendezvous')).toBe(valid.idServerUrl);
    expect(fallback.getUpstream('relay')).toBe(valid.relayServerUrl);
  });

  it.each([
    undefined,
    '',
    'http://console.example.com',
    'https://console.example.com/',
    'https://console.example.com/path',
    'https://console.example.com?secret=x',
    'https://console.example.com#secret',
    'https://user:secret@console.example.com',
    'https://@console.example.com',
    'https://CONSOLE.example.com',
    'https://console.example.com:443',
    ' https://console.example.com',
    'https://console.example.com\n',
    'https:\\console.example.com',
  ])('拒绝非规范精确 HTTPS Origin %s', async (origin) => {
    const instance = await service({ ...valid, allowedOrigin: origin });
    expect(() => instance.getConfiguration()).toThrow(
      ServiceUnavailableException,
    );
  });

  it.each(['idServerUrl', 'relayServerUrl'] as const)(
    '公开 %s 必须是无秘密的完整 WSS 地址',
    async (name) => {
      for (const value of [
        undefined,
        '',
        'ws://public/ws',
        'https://public/ws',
        'wss://user:secret@public/ws',
        'wss://@public/ws',
        'wss://public/ws?secret=x',
        'wss://public/ws#secret',
        'wss://public/with space',
        ' wss://public/ws',
        'wss:\\public\\ws',
        'wss://',
      ]) {
        const instance = await service({ ...valid, [name]: value });
        expect(() => instance.getConfiguration()).toThrow(
          ServiceUnavailableException,
        );
      }
    },
  );

  it.each(['idUpstreamUrl', 'relayUpstreamUrl'] as const)(
    '内部 %s 不接受其它协议、凭据或查询',
    async (name) => {
      // Note: an empty string means "not set" for stored settings (it is how
      // the API clears an upstream override), so only non-empty bad values fail.
      for (const value of [
        'https://internal',
        'file:///secret',
        'ws://user:secret@internal',
        'ws://@internal',
        'ws://internal?secret=x',
        'ws://internal#secret',
        'ws://internal\t',
        'ws:\\internal',
      ]) {
        const instance = await service({ ...valid, [name]: value });
        expect(() => instance.getConfiguration()).toThrow(
          ServiceUnavailableException,
        );
      }
    },
  );

  it.each([
    undefined,
    '',
    Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'),
    valid.serverPublicKey!.slice(0, -1),
    `${valid.serverPublicKey}\n`,
  ])('公钥必须是规范的32字节base64 %s', async (key) => {
    const instance = await service({ ...valid, serverPublicKey: key });
    expect(() => instance.getConfiguration()).toThrow(
      ServiceUnavailableException,
    );
  });

  it('任何配置错误均返回固定503，不回显秘密或原始值', async () => {
    const instance = await service({
      ...valid,
      idUpstreamUrl: 'ws://secret-user:secret-password@internal',
    });
    try {
      instance.getConfiguration();
      throw new Error('应拒绝错误配置');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const exception = error as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toEqual({
        message: 'Web client configuration is unavailable',
        error: 'Service Unavailable',
        statusCode: 503,
      });
      expect(JSON.stringify(exception.getResponse())).not.toContain('secret-');
    }
  });

  it('设置更新后刷新立即生效，读取失败保留上一个快照', async () => {
    let settings: WebClientSettings = { ...valid };
    const instance = new WebClientService({
      getActiveConfig: () => settings,
    } as unknown as WebClientSettingsService);
    await instance.onModuleInit();
    expect(instance.getConfiguration().enabled).toBe(true);

    settings = { enabled: false };
    await instance.refresh();
    expect(instance.getConfiguration()).toEqual({ enabled: false });

    settings = { ...valid, allowedOrigin: 'not-a-url' };
    await instance.refresh();
    expect(() => instance.getConfiguration()).toThrow(
      ServiceUnavailableException,
    );

    const failing = new WebClientService({
      getActiveConfig: (): never => {
        throw new Error('database unavailable');
      },
    } as unknown as WebClientSettingsService);
    await failing.onModuleInit();
    expect(failing.getConfiguration()).toEqual({ enabled: false });
  });
});
