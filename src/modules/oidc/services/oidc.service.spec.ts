import 'reflect-metadata';
import * as client from 'openid-client';
import { IsNull } from 'typeorm';
import { OidcService } from './oidc.service';
import { User } from '../../user/entities/user.entity';
import {
  OidcProvider,
  OidcProviderType,
} from '../entities/oidc-provider.entity';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});
jest.mock('openid-client', () => ({
  randomPKCECodeVerifier: jest.fn(),
  calculatePKCECodeChallenge: jest.fn(),
  randomState: jest.fn(),
  randomNonce: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  discovery: jest.fn(),
  authorizationCodeGrant: jest.fn(),
  fetchUserInfo: jest.fn(),
  Configuration: jest.fn(),
}));

interface OidcUserInfoInput {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
}

type FindOrCreateUser = (
  userInfo: OidcUserInfoInput,
  providerName: string,
) => Promise<User>;

function findOrCreateUser(service: OidcService): FindOrCreateUser {
  return (
    service as unknown as { findOrCreateUser: FindOrCreateUser }
  ).findOrCreateUser.bind(service);
}

describe('OidcService avatar sync', () => {
  let service: OidcService;
  let userRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository = {
      findOne: jest.fn(),
      save: jest.fn((user: User) => Promise.resolve(user)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const userGroupService = {
      resolveUserGroupGuid: jest.fn().mockResolvedValue(null),
    };
    service = new OidcService(
      undefined as never,
      undefined as never,
      userRepository as never,
      undefined as never,
      undefined as never,
      undefined as never,
      userGroupService as never,
    );
  });

  it('stores the provider picture when creating a new OIDC user', async () => {
    userRepository.findOne.mockResolvedValue(null);

    const user = await findOrCreateUser(service)(
      {
        sub: 'sub-1',
        preferred_username: 'alice',
        email: 'alice@example.com',
        email_verified: true,
        picture: 'https://provider.example.com/alice.png',
      },
      'test-provider',
    );

    expect(user.avatar).toBe('https://provider.example.com/alice.png');
    expect(userRepository.save).toHaveBeenCalled();
  });

  it('backfills the avatar for an existing user without one', async () => {
    const existing = new User();
    existing.guid = 'user-guid';
    existing.username = 'alice';
    existing.oidcSubject = 'oidc:test-provider:sub-1';
    existing.avatar = null;
    userRepository.findOne.mockResolvedValue(existing);
    userRepository.update.mockResolvedValue({ affected: 1 });

    const user = await findOrCreateUser(service)(
      {
        sub: 'sub-1',
        picture: 'https://provider.example.com/alice.png',
      },
      'test-provider',
    );

    expect(user).toBe(existing);
    expect(user.avatar).toBe('https://provider.example.com/alice.png');
    expect(userRepository.update).toHaveBeenCalledWith(
      { guid: 'user-guid', avatar: IsNull() },
      { avatar: 'https://provider.example.com/alice.png' },
    );
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('keeps a concurrently uploaded avatar when the conditional backfill loses the race', async () => {
    const existing = new User();
    existing.guid = 'user-guid';
    existing.username = 'alice';
    existing.oidcSubject = 'oidc:test-provider:sub-1';
    existing.avatar = null;
    userRepository.findOne.mockResolvedValue(existing);
    userRepository.update.mockResolvedValue({ affected: 0 });

    const user = await findOrCreateUser(service)(
      {
        sub: 'sub-1',
        picture: 'https://provider.example.com/alice.png',
      },
      'test-provider',
    );

    expect(user).toBe(existing);
    expect(user.avatar).toBeNull();
  });

  it('does not overwrite a manually set avatar', async () => {
    const existing = new User();
    existing.guid = 'user-guid';
    existing.username = 'alice';
    existing.oidcSubject = 'oidc:test-provider:sub-1';
    existing.avatar = '/api/avatars/user-guid.webp?v=123';
    userRepository.findOne.mockResolvedValue(existing);

    const user = await findOrCreateUser(service)(
      {
        sub: 'sub-1',
        picture: 'https://provider.example.com/alice.png',
      },
      'test-provider',
    );

    expect(user.avatar).toBe('/api/avatars/user-guid.webp?v=123');
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('ignores non-http(s) picture URLs', async () => {
    userRepository.findOne.mockResolvedValue(null);

    const user = await findOrCreateUser(service)(
      {
        sub: 'sub-2',
        preferred_username: 'bob',
        picture: 'data:image/png;base64,AAAA',
      },
      'test-provider',
    );

    expect(user.avatar).toBeNull();
  });

  it('ignores picture URLs longer than 255 characters', async () => {
    userRepository.findOne.mockResolvedValue(null);

    const user = await findOrCreateUser(service)(
      {
        sub: 'sub-3',
        preferred_username: 'carol',
        picture: `https://provider.example.com/${'a'.repeat(250)}`,
      },
      'test-provider',
    );

    expect(user.avatar).toBeNull();
  });

  describe('handleOidcCallback picture extraction', () => {
    const authorizationCodeGrantMock =
      client.authorizationCodeGrant as unknown as jest.Mock;
    const fetchUserInfoMock = client.fetchUserInfo as unknown as jest.Mock;

    const oidcConfig = {
      serverMetadata: () => ({
        userinfo_endpoint: 'https://provider.example.com/userinfo',
      }),
    };

    const authState = {
      codeVerifier: 'verifier',
      state: 'state',
      nonce: 'nonce',
    };

    function invokeHandleOidcCallback(): Promise<{
      sub: string;
      email?: string;
      email_verified?: boolean;
      picture?: string;
    }> {
      return (
        service as unknown as {
          handleOidcCallback(
            config: unknown,
            callbackUrl: string,
            state: unknown,
          ): Promise<{
            sub: string;
            email?: string;
            email_verified?: boolean;
            picture?: string;
          }>;
        }
      ).handleOidcCallback.bind(service)(
        oidcConfig,
        'https://backend.example.com/api/oidc/callback?code=x&state=y',
        authState,
      );
    }

    it('merges the picture from the userinfo endpoint when missing from the ID token', async () => {
      authorizationCodeGrantMock.mockResolvedValue({
        claims: () => ({
          sub: 'sub-1',
          email: 'alice@example.com',
          email_verified: true,
        }),
        access_token: 'access-token',
      });
      fetchUserInfoMock.mockResolvedValue({
        sub: 'sub-1',
        email: 'alice@example.com',
        name: 'Alice',
        picture: 'https://provider.example.com/alice.png',
      });

      const userInfo = await invokeHandleOidcCallback();

      expect(fetchUserInfoMock).toHaveBeenCalled();
      expect(userInfo.picture).toBe('https://provider.example.com/alice.png');
      expect(userInfo.email).toBe('alice@example.com');
    });

    it('does not adopt userinfo email_verified for a mismatched userinfo email', async () => {
      authorizationCodeGrantMock.mockResolvedValue({
        claims: () => ({
          sub: 'sub-1',
          email: 'id-token@example.com',
        }),
        access_token: 'access-token',
      });
      fetchUserInfoMock.mockResolvedValue({
        sub: 'sub-1',
        email: 'userinfo@example.com',
        email_verified: true,
        picture: 'https://provider.example.com/alice.png',
      });

      const userInfo = await invokeHandleOidcCallback();

      expect(userInfo.email).toBe('id-token@example.com');
      expect(userInfo.email_verified).toBeUndefined();
    });

    it('adopts userinfo email_verified when the userinfo email is selected', async () => {
      authorizationCodeGrantMock.mockResolvedValue({
        claims: () => ({
          sub: 'sub-1',
        }),
        access_token: 'access-token',
      });
      fetchUserInfoMock.mockResolvedValue({
        sub: 'sub-1',
        email: 'userinfo@example.com',
        email_verified: true,
        picture: 'https://provider.example.com/alice.png',
      });

      const userInfo = await invokeHandleOidcCallback();

      expect(userInfo.email).toBe('userinfo@example.com');
      expect(userInfo.email_verified).toBe(true);
    });

    it('skips the userinfo request when the ID token already carries email and picture', async () => {
      authorizationCodeGrantMock.mockResolvedValue({
        claims: () => ({
          sub: 'sub-1',
          email: 'alice@example.com',
          email_verified: true,
          picture: 'https://provider.example.com/alice.png',
        }),
        access_token: 'access-token',
      });

      const userInfo = await invokeHandleOidcCallback();

      expect(fetchUserInfoMock).not.toHaveBeenCalled();
      expect(userInfo.picture).toBe('https://provider.example.com/alice.png');
    });
  });

  describe('fetchOAuth2UserInfo picture extraction', () => {
    it('maps avatar_url from OAuth2 providers such as GitHub', async () => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 1,
            login: 'gh-user',
            name: 'GH User',
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
          }),
      } as Response);

      const provider = {
        name: 'github',
        type: OidcProviderType.OAUTH2,
        userinfoEndpoint: 'https://api.github.com/user',
      } as OidcProvider;

      const userInfo = await (
        service as unknown as {
          fetchOAuth2UserInfo(
            accessToken: string,
            provider: OidcProvider,
          ): Promise<OidcUserInfoInput>;
        }
      ).fetchOAuth2UserInfo.bind(service)('token', provider);

      expect(userInfo.picture).toBe(
        'https://avatars.githubusercontent.com/u/1',
      );
      fetchMock.mockRestore();
    });

    it('falls back to picture when avatar_url is an empty string', async () => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 1,
            login: 'gh-user',
            avatar_url: '',
            picture: 'https://provider.example.com/gh-user.png',
          }),
      } as Response);

      const provider = {
        name: 'github',
        type: OidcProviderType.OAUTH2,
        userinfoEndpoint: 'https://api.github.com/user',
      } as OidcProvider;

      const userInfo = await (
        service as unknown as {
          fetchOAuth2UserInfo(
            accessToken: string,
            provider: OidcProvider,
          ): Promise<OidcUserInfoInput>;
        }
      ).fetchOAuth2UserInfo.bind(service)('token', provider);

      expect(userInfo.picture).toBe('https://provider.example.com/gh-user.png');
      fetchMock.mockRestore();
    });
  });
});
