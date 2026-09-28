import 'reflect-metadata';
import { DataSource, Repository } from 'typeorm';
import { AuthUserHelper } from './auth-user.helper';
import { AuthResponseHelper } from './auth-response.helper';
import { LoginSession } from '../entities/login-session.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { UserGroup } from '../../user-group/entities/user-group.entity';
import { Strategy } from '../../strategy/entities/strategy.entity';
import { AddressBook } from '../../address-book/entities/address-book.entity';
import { AddressBookPeer } from '../../address-book/entities/address-book-peer.entity';
import { AddressBookPeerTag } from '../../address-book/entities/address-book-peer-tag.entity';
import { AddressBookRule } from '../../address-book/entities/address-book-rule.entity';
import { AddressBookTag } from '../../address-book/entities/address-book-tag.entity';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

describe('current user 2FA status', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let userHelper: AuthUserHelper;
  let responseHelper: AuthResponseHelper;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      dropSchema: true,
      synchronize: true,
      logging: false,
      entities: [
        UserGroup,
        User,
        UserToken,
        LoginSession,
        Strategy,
        AddressBook,
        AddressBookPeer,
        AddressBookTag,
        AddressBookPeerTag,
        AddressBookRule,
      ],
    });
    await dataSource.initialize();

    userRepository = dataSource.getRepository(User);
    userHelper = new AuthUserHelper(userRepository);
    responseHelper = new AuthResponseHelper();
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function createUser(
    guid: string,
    username: string,
    tfaSecret: string,
  ): Promise<User> {
    const user = new User();
    user.guid = guid;
    user.username = username;
    user.status = UserStatus.ACTIVE;
    user.isAdmin = false;
    user.password = 'hashed-password';
    user.tfaSecret = tfaSecret;
    user.info = null as unknown as string;
    return userRepository.save(user);
  }

  it('reports an already configured TOTP secret as enabled for /currentUser', async () => {
    const user = await createUser(
      'guid-tfa-enabled',
      'tfa-enabled-user',
      'BASE32SECRET',
    );

    // /api/currentUser 的查询：显式加载敏感字段
    const loaded = await userHelper.findByGuid(user.guid, {
      withPassword: true,
      withTfaSecret: true,
    });
    expect(loaded).not.toBeNull();

    const payload = responseHelper.buildCurrentUserPayload(loaded!);
    expect(payload.tfa_enabled).toBe(true);
    expect(payload.has_password).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('BASE32SECRET');

    // 未加载敏感字段时不得误报为“未启用”
    const withoutSecrets = await userHelper.findByGuid(user.guid);
    expect(responseHelper.buildUserPayload(withoutSecrets!)).not.toHaveProperty(
      'tfa_enabled',
    );
  });

  it('reports a disabled TOTP secret as not enabled', async () => {
    const user = await createUser('guid-tfa-disabled', 'tfa-disabled-user', '');

    const loaded = await userHelper.findByGuid(user.guid, {
      withPassword: true,
      withTfaSecret: true,
    });

    expect(responseHelper.buildCurrentUserPayload(loaded!).tfa_enabled).toBe(
      false,
    );
  });
});
