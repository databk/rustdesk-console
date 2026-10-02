import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { WebClientService } from './web-client.service';

const valid = {
  WEB_CLIENT_ENABLED: 'true',
  WEB_CLIENT_ID_SERVER_URL: 'wss://remote.example.com/id',
  WEB_CLIENT_RELAY_SERVER_URL: 'wss://remote.example.com/relay',
  WEB_CLIENT_SERVER_PUBLIC_KEY: Buffer.alloc(32).toString('base64'),
};
const service = (values: Record<string, unknown>) =>
  new WebClientService(new ConfigService(values));

describe('WebClientService', () => {
  it('defaults to disabled and discloses no other settings', () => {
    expect(service({}).getConfiguration()).toEqual({ enabled: false });
    expect(
      service({
        ...valid,
        WEB_CLIENT_ENABLED: 'false',
        JWT_SECRET: 'private',
      }).getConfiguration(),
    ).toEqual({ enabled: false });
  });

  it('returns only the authenticated deployment profile', () => {
    expect(
      service({ ...valid, JWT_SECRET: 'private' }).getConfiguration(),
    ).toEqual({
      enabled: true,
      idServerUrl: valid.WEB_CLIENT_ID_SERVER_URL,
      relayServerUrl: valid.WEB_CLIENT_RELAY_SERVER_URL,
      serverPublicKey: valid.WEB_CLIENT_SERVER_PUBLIC_KEY,
    });
  });

  it.each(['', 'TRUE', '1', ' false '])(
    'rejects ambiguous enabled value %j',
    (enabled) => {
      expect(() =>
        service({ ...valid, WEB_CLIENT_ENABLED: enabled }).getConfiguration(),
      ).toThrow(ServiceUnavailableException);
    },
  );

  it.each([
    'ws://remote.example.com',
    'https://remote.example.com',
    'wss://user:private@remote.example.com',
    'wss://@remote.example.com',
    'wss://remote.example.com?private',
    'wss://remote.example.com?',
    'wss://remote.example.com#',
    ' wss://remote.example.com',
    'wss://remote.example.com\n',
  ])('rejects unsafe URL %j without echoing it', (url) => {
    try {
      service({ ...valid, WEB_CLIENT_ID_SERVER_URL: url }).getConfiguration();
      throw new Error('Expected configuration failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toBe(
        'Web client configuration is unavailable',
      );
    }
  });

  it.each([
    '',
    'private',
    Buffer.alloc(64).toString('base64'),
    valid.WEB_CLIENT_SERVER_PUBLIC_KEY.slice(0, -1),
    valid.WEB_CLIENT_SERVER_PUBLIC_KEY + ' ',
  ])('rejects malformed or wrong-length key', (key) => {
    expect(() =>
      service({
        ...valid,
        WEB_CLIENT_SERVER_PUBLIC_KEY: key,
      }).getConfiguration(),
    ).toThrow(ServiceUnavailableException);
  });
});
