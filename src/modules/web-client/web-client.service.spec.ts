import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClientService } from './web-client.service';

describe('网页远控配置边界', () => {
  const valid = {
    WEB_CLIENT_ENABLED: 'true',
    WEB_CLIENT_ALLOWED_ORIGIN: 'https://console.example.com:8443',
    WEB_CLIENT_ID_SERVER_URL: 'wss://console.example.com/ws/id',
    WEB_CLIENT_RELAY_SERVER_URL: 'wss://console.example.com/ws/relay',
    WEB_CLIENT_SERVER_PUBLIC_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  const service = (values: Record<string, unknown>) =>
    new WebClientService(new ConfigService(values));

  it.each([undefined, 'false'])(
    '默认或显式关闭不读取其它错误配置 %s',
    (enabled) => {
      const instance = service({
        WEB_CLIENT_ENABLED: enabled,
        WEB_CLIENT_ALLOWED_ORIGIN: 'invalid-secret-origin',
        WEB_CLIENT_ID_UPSTREAM_URL: 'ws://user:secret@internal',
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
    },
  );

  it.each(['TRUE', '1', '', true, 1])('开关必须是明确字符串 %s', (enabled) => {
    expect(() =>
      service({ ...valid, WEB_CLIENT_ENABLED: enabled }).getConfiguration(),
    ).toThrow(ServiceUnavailableException);
  });

  it('公开投影只有三个公开配置，固定内部端点仅供网关使用', () => {
    const instance = service({
      ...valid,
      WEB_CLIENT_ID_UPSTREAM_URL: 'ws://hbbs:21118/internal-id',
      WEB_CLIENT_RELAY_UPSTREAM_URL: 'wss://hbbr:21119/internal-relay',
      JWT_SECRET: 'secret-jwt',
    });
    expect(instance.getConfiguration()).toEqual({
      enabled: true,
      idServerUrl: valid.WEB_CLIENT_ID_SERVER_URL,
      relayServerUrl: valid.WEB_CLIENT_RELAY_SERVER_URL,
      serverPublicKey: valid.WEB_CLIENT_SERVER_PUBLIC_KEY,
    });
    expect(instance.getAllowedOrigin()).toBe(valid.WEB_CLIENT_ALLOWED_ORIGIN);
    expect(instance.getUpstream('rendezvous')).toBe(
      'ws://hbbs:21118/internal-id',
    );
    expect(instance.getUpstream('relay')).toBe(
      'wss://hbbr:21119/internal-relay',
    );
    const fallback = service(valid);
    expect(fallback.getUpstream('rendezvous')).toBe(
      valid.WEB_CLIENT_ID_SERVER_URL,
    );
    expect(fallback.getUpstream('relay')).toBe(
      valid.WEB_CLIENT_RELAY_SERVER_URL,
    );
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
  ])('拒绝非规范精确 HTTPS Origin %s', (origin) => {
    expect(() =>
      service({
        ...valid,
        WEB_CLIENT_ALLOWED_ORIGIN: origin,
      }).getConfiguration(),
    ).toThrow(ServiceUnavailableException);
  });

  it.each(['WEB_CLIENT_ID_SERVER_URL', 'WEB_CLIENT_RELAY_SERVER_URL'])(
    '公开 %s 必须是无秘密的完整 WSS 地址',
    (name) => {
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
        expect(() =>
          service({ ...valid, [name]: value }).getConfiguration(),
        ).toThrow(ServiceUnavailableException);
      }
    },
  );

  it.each(['WEB_CLIENT_ID_UPSTREAM_URL', 'WEB_CLIENT_RELAY_UPSTREAM_URL'])(
    '内部 %s 不接受其它协议、凭据或查询',
    (name) => {
      for (const value of [
        '',
        'https://internal',
        'file:///secret',
        'ws://user:secret@internal',
        'ws://@internal',
        'ws://internal?secret=x',
        'ws://internal#secret',
        'ws://internal\t',
        'ws:\\internal',
      ]) {
        expect(() =>
          service({ ...valid, [name]: value }).getConfiguration(),
        ).toThrow(ServiceUnavailableException);
      }
    },
  );

  it.each([
    undefined,
    '',
    Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'),
    valid.WEB_CLIENT_SERVER_PUBLIC_KEY.slice(0, -1),
    `${valid.WEB_CLIENT_SERVER_PUBLIC_KEY}\n`,
  ])('公钥必须是规范的32字节base64 %s', (key) => {
    expect(() =>
      service({
        ...valid,
        WEB_CLIENT_SERVER_PUBLIC_KEY: key,
      }).getConfiguration(),
    ).toThrow(ServiceUnavailableException);
  });

  it('任何配置错误均返回固定503，不回显秘密或原始值', () => {
    const instance = service({
      ...valid,
      WEB_CLIENT_ID_UPSTREAM_URL: 'ws://secret-user:secret-password@internal',
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
});
