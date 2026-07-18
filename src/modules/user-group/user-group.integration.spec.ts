import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { AdminGuard } from '../../common/guards/admin.guard';
import { DatabaseInitService } from '../../database/database-init.service';
import { AddressBookPeerTag } from '../address-book/entities/address-book-peer-tag.entity';
import { AddressBookPeer } from '../address-book/entities/address-book-peer.entity';
import {
  AddressBookRule,
  ShareRule,
} from '../address-book/entities/address-book-rule.entity';
import { AddressBookTag } from '../address-book/entities/address-book-tag.entity';
import { AddressBook } from '../address-book/entities/address-book.entity';
import { AddressBookController } from '../address-book/address-book.controller';
import { DeleteAddressBooksDto } from '../address-book/dto/profile.dto';
import { CreateRuleDto } from '../address-book/dto/rule.dto';
import { AddressBookPermissionService } from '../address-book/services/address-book-permission.service';
import { AddressBookRuleService } from '../address-book/services/address-book-rule.service';
import { DeviceGroupUserPermission } from '../device-group/entities/device-group-user-permission.entity';
import { UserUserPermission } from '../device-group/entities/user-user-permission.entity';
import { AuthService } from '../auth/services/auth.service';
import { LdapService } from '../ldap/ldap.service';
import { OidcService } from '../oidc/services/oidc.service';
import { Strategy } from '../strategy/entities/strategy.entity';
import { CreateUserDto, UserQueryDto } from '../user/dto/user.dto';
import { UserToken } from '../user/entities/user-token.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { UserGroupMembersDto, UserGroupQueryDto } from './dto/user-group.dto';
import { UserGroup } from './entities/user-group.entity';
import { UserGroupController } from './user-group.controller';
import { UserGroupService } from './user-group.service';

interface UserGroupHttpBody {
  guid: string;
  name: string;
  note: string;
  user_count: number;
}

interface UserGroupListHttpBody {
  data: UserGroupHttpBody[];
  total: number;
}

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});
jest.mock('openid-client', () => ({}));

describe('User group integration', () => {
  let dataSource: DataSource;
  let groupRepository: Repository<UserGroup>;
  let userRepository: Repository<User>;
  let ruleRepository: Repository<AddressBookRule>;
  let addressBookRepository: Repository<AddressBook>;
  let userGroupService: UserGroupService;
  let permissionService: AddressBookPermissionService;
  let ruleService: AddressBookRuleService;
  let userService: UserService;

  beforeEach(async () => {
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
        Strategy,
        AddressBook,
        AddressBookPeer,
        AddressBookTag,
        AddressBookPeerTag,
        AddressBookRule,
      ],
    });
    await dataSource.initialize();

    groupRepository = dataSource.getRepository(UserGroup);
    userRepository = dataSource.getRepository(User);
    ruleRepository = dataSource.getRepository(AddressBookRule);
    addressBookRepository = dataSource.getRepository(AddressBook);

    userGroupService = new UserGroupService(
      groupRepository,
      userRepository,
      ruleRepository,
      dataSource,
    );
    permissionService = new AddressBookPermissionService(
      addressBookRepository,
      ruleRepository,
      userRepository,
    );
    ruleService = new AddressBookRuleService(
      ruleRepository,
      addressBookRepository,
      userRepository,
      permissionService,
      userGroupService,
      dataSource,
    );
    userService = new UserService(
      userRepository,
      dataSource.getRepository(UserToken),
      {} as Repository<DeviceGroupUserPermission>,
      {} as Repository<UserUserPermission>,
      userGroupService,
    );
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  async function createUser(
    username: string,
    userGroupGuid: string | null,
  ): Promise<User> {
    return userRepository.save(
      userRepository.create({
        guid: randomUUID(),
        username,
        email: null,
        password: 'hashed-password',
        note: '',
        status: UserStatus.ACTIVE,
        isAdmin: false,
        userGroupGuid,
      }),
    );
  }

  async function createAddressBook(
    owner: string,
    name = 'Shared book',
    isShared = false,
  ): Promise<AddressBook> {
    return addressBookRepository.save(
      addressBookRepository.create({
        guid: randomUUID(),
        owner,
        name,
        isPersonal: false,
        isShared,
      }),
    );
  }

  async function createRule(
    addressBookGuid: string,
    targetUserId: string | null,
    targetGroupId: string | null,
    rule: ShareRule,
  ): Promise<AddressBookRule> {
    return ruleRepository.save(
      ruleRepository.create({
        guid: randomUUID(),
        addressBookGuid,
        targetUserId,
        targetGroupId,
        rule,
      }),
    );
  }

  it('initializes a single default group, backfills users, and cleans legacy rule targets', async () => {
    const legacyUser = await createUser('legacy-user', null);
    const addressBook = await createAddressBook(legacyUser.guid);
    const everyoneRuleGuid = randomUUID();
    const invalidGroupRuleGuid = randomUUID();

    await dataSource.query('PRAGMA foreign_keys = OFF');
    await dataSource.query(
      `INSERT INTO address_book_rules
       (guid, addressBookGuid, targetUserId, targetGroupId, rule, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [everyoneRuleGuid, addressBook.guid, '', '', ShareRule.READ],
    );
    await dataSource.query(
      `INSERT INTO address_book_rules
       (guid, addressBookGuid, targetUserId, targetGroupId, rule, createdAt, updatedAt)
       VALUES (?, ?, NULL, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [invalidGroupRuleGuid, addressBook.guid, randomUUID(), ShareRule.READ],
    );
    await dataSource.query('PRAGMA foreign_keys = ON');

    const firstDefault = await userGroupService.initializeStorage();
    const secondDefault = await userGroupService.initializeStorage();

    expect(secondDefault.guid).toBe(firstDefault.guid);
    expect(await groupRepository.count({ where: { isDefault: true } })).toBe(1);
    expect(
      (await userRepository.findOneByOrFail({ guid: legacyUser.guid }))
        .userGroupGuid,
    ).toBe(firstDefault.guid);

    const everyoneRule = await ruleRepository.findOneByOrFail({
      guid: everyoneRuleGuid,
    });
    expect(everyoneRule.targetUserId).toBeNull();
    expect(everyoneRule.targetGroupId).toBeNull();
    expect(
      await ruleRepository.findOneBy({ guid: invalidGroupRuleGuid }),
    ).toBeNull();
    expect(await dataSource.query('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('enforces normalized names and moves members atomically', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const operations = await userGroupService.createGroup({
      name: '  Operations  ',
      note: '  Primary operators  ',
    });

    expect(operations.name).toBe('Operations');
    expect(operations.note).toBe('Primary operators');
    await expect(userGroupService.createGroup({ name: '   ' })).rejects.toThrow(
      '用户组名称不能为空',
    );
    await expect(
      userGroupService.createGroup({ name: 'operations' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      userGroupService.updateGroup(operations.guid, {
        name: 'Operations Team',
      }),
    ).resolves.toMatchObject({ name: 'Operations Team' });

    const alice = await createUser('alice', defaultGroup.guid);
    const bob = await createUser('bob', defaultGroup.guid);
    await expect(
      userGroupService.moveUsers(operations.guid, [alice.guid, randomUUID()]),
    ).rejects.toThrow('一个或多个用户不存在');
    expect(
      (await userRepository.findOneByOrFail({ guid: alice.guid }))
        .userGroupGuid,
    ).toBe(defaultGroup.guid);

    await expect(
      userGroupService.moveUsers(operations.guid, [alice.guid, bob.guid]),
    ).resolves.toMatchObject({ moved_user_count: 2 });

    const groups = await userGroupService.getGroups({
      current: 1,
      pageSize: 20,
      search: 'OPER',
    });
    expect(groups.total).toBe(1);
    expect(groups.data[0]).toMatchObject({
      guid: operations.guid,
      user_count: 2,
    });

    const members = await userGroupService.getGroupUsers(operations.guid, {
      current: 1,
      pageSize: 20,
    });
    expect(members.total).toBe(2);
    expect(members.data.map((user) => user.name)).toEqual(['alice', 'bob']);
    await expect(
      userGroupService.getGroupUsers(randomUUID(), {
        current: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow('用户组不存在');
  });

  it('uses user_group_guid while keeping legacy group_name as a no-op', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const selectedGroup = await userGroupService.createGroup({
      name: 'Selected',
    });

    await userService.createUser({
      name: 'legacy-field-user',
      password: 'test-password',
      group_name: 'Selected',
    });
    await userService.createUser({
      name: 'canonical-field-user',
      password: 'test-password',
      user_group_guid: selectedGroup.guid,
    });
    await userService.inviteUser({
      name: 'invited-user',
      email: 'invited@example.com',
      user_group_guid: selectedGroup.guid,
    });

    expect(
      (
        await userRepository.findOneByOrFail({
          username: 'legacy-field-user',
        })
      ).userGroupGuid,
    ).toBe(defaultGroup.guid);
    expect(
      (
        await userRepository.findOneByOrFail({
          username: 'canonical-field-user',
        })
      ).userGroupGuid,
    ).toBe(selectedGroup.guid);
    expect(
      (await userRepository.findOneByOrFail({ username: 'invited-user' }))
        .userGroupGuid,
    ).toBe(selectedGroup.guid);
  });

  it('assigns the default group in admin seed, registration, LDAP JIT, and OIDC JIT paths', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const authService = new AuthService(
      userRepository,
      dataSource.getRepository(UserToken),
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      userGroupService,
    );
    const databaseInitService = new DatabaseInitService(
      userRepository,
      undefined as never,
      undefined as never,
      userGroupService,
    );
    const ldapService = new LdapService(
      userRepository,
      undefined as never,
      userGroupService,
    );
    const oidcService = new OidcService(
      undefined as never,
      undefined as never,
      userRepository,
      undefined as never,
      undefined as never,
      undefined as never,
      userGroupService,
    );

    const previousAdminUsername = process.env.ADMIN_USERNAME;
    const previousAdminEmail = process.env.ADMIN_EMAIL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_USERNAME = 'seed-admin';
    process.env.ADMIN_EMAIL = 'seed-admin@example.com';
    process.env.ADMIN_PASSWORD = 'seed-password';

    try {
      await (
        databaseInitService as unknown as {
          createDefaultAdmin(groupGuid: string): Promise<void>;
        }
      ).createDefaultAdmin(defaultGroup.guid);
    } finally {
      if (previousAdminUsername === undefined) {
        delete process.env.ADMIN_USERNAME;
      } else {
        process.env.ADMIN_USERNAME = previousAdminUsername;
      }
      if (previousAdminEmail === undefined) {
        delete process.env.ADMIN_EMAIL;
      } else {
        process.env.ADMIN_EMAIL = previousAdminEmail;
      }
      if (previousAdminPassword === undefined) {
        delete process.env.ADMIN_PASSWORD;
      } else {
        process.env.ADMIN_PASSWORD = previousAdminPassword;
      }
    }

    await authService.register({
      username: 'registered-user',
      email: 'registered@example.com',
      password: 'registered-password',
    });
    await (
      ldapService as unknown as {
        findOrCreateUser(
          userInfo: {
            dn: string;
            username: string;
            email: string;
            displayName: string;
            groups: string[];
          },
          config: { adminGroups: string[] },
        ): Promise<User>;
      }
    ).findOrCreateUser(
      {
        dn: 'cn=ldap-user,dc=example,dc=com',
        username: 'ldap-user',
        email: 'ldap@example.com',
        displayName: 'LDAP User',
        groups: [],
      },
      { adminGroups: [] },
    );
    await (
      oidcService as unknown as {
        findOrCreateUser(
          userInfo: {
            sub: string;
            preferred_username: string;
            email: string;
            email_verified: boolean;
          },
          providerName: string,
        ): Promise<User>;
      }
    ).findOrCreateUser(
      {
        sub: 'oidc-subject',
        preferred_username: 'oidc-user',
        email: 'oidc@example.com',
        email_verified: true,
      },
      'test-provider',
    );

    const createdUsers = await userRepository.find({
      where: [
        { username: 'seed-admin' },
        { username: 'registered-user' },
        { username: 'ldap-user' },
        { username: 'oidc-user' },
      ],
    });
    expect(createdUsers).toHaveLength(4);
    expect(
      createdUsers.every((user) => user.userGroupGuid === defaultGroup.guid),
    ).toBe(true);
  });

  it('deletes group grants and moves members in one transaction', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const temporaryGroup = await userGroupService.createGroup({
      name: 'Temporary',
    });
    const owner = await createUser('owner', defaultGroup.guid);
    const member = await createUser('member', temporaryGroup.guid);
    const addressBook = await createAddressBook(owner.guid);
    await createRule(
      addressBook.guid,
      null,
      temporaryGroup.guid,
      ShareRule.READ_WRITE,
    );

    await expect(
      userGroupService.deleteGroup(temporaryGroup.guid),
    ).resolves.toEqual({
      message: '用户组删除成功',
      moved_user_count: 1,
      deleted_rule_count: 1,
    });
    expect(
      (await userRepository.findOneByOrFail({ guid: member.guid }))
        .userGroupGuid,
    ).toBe(defaultGroup.guid);
    expect(
      await groupRepository.findOneBy({ guid: temporaryGroup.guid }),
    ).toBeNull();
    expect(
      await ruleRepository.count({
        where: { targetGroupId: temporaryGroup.guid },
      }),
    ).toBe(0);
    await expect(
      userGroupService.deleteGroup(defaultGroup.guid),
    ).rejects.toThrow('默认用户组不能删除');
  });

  it('rolls back member and rule changes when group deletion fails', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const protectedGroup = await userGroupService.createGroup({
      name: 'Rollback target',
    });
    const owner = await createUser('rollback-owner', defaultGroup.guid);
    const member = await createUser('rollback-member', protectedGroup.guid);
    const addressBook = await createAddressBook(owner.guid);
    const rule = await createRule(
      addressBook.guid,
      null,
      protectedGroup.guid,
      ShareRule.READ,
    );
    await dataSource.query(
      `CREATE TRIGGER fail_user_group_delete
       BEFORE DELETE ON user_groups
       WHEN OLD.isDefault = 0
       BEGIN
         SELECT RAISE(ABORT, 'forced delete failure');
       END`,
    );

    await expect(
      userGroupService.deleteGroup(protectedGroup.guid),
    ).rejects.toThrow('forced delete failure');
    expect(
      (await userRepository.findOneByOrFail({ guid: member.guid }))
        .userGroupGuid,
    ).toBe(protectedGroup.guid);
    expect(await ruleRepository.findOneBy({ guid: rule.guid })).not.toBeNull();
    expect(
      await groupRepository.findOneBy({ guid: protectedGroup.guid }),
    ).not.toBeNull();
  });

  it('resolves owner, direct, group, and everyone rules by strongest permission', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const operators = await userGroupService.createGroup({ name: 'Operators' });
    const guests = await userGroupService.createGroup({ name: 'Guests' });
    const owner = await createUser('book-owner', defaultGroup.guid);
    const member = await createUser('operator', operators.guid);
    const outsider = await createUser('guest', guests.guid);
    const addressBook = await createAddressBook(owner.guid, 'Operations book');

    await createRule(addressBook.guid, member.guid, null, ShareRule.READ);
    await createRule(
      addressBook.guid,
      null,
      operators.guid,
      ShareRule.FULL_CONTROL,
    );
    await createRule(addressBook.guid, null, null, ShareRule.READ_WRITE);

    await expect(
      permissionService.checkAddressBookAccess(
        addressBook.guid,
        owner.guid,
        ShareRule.FULL_CONTROL,
      ),
    ).resolves.toMatchObject({ guid: addressBook.guid });
    await expect(
      permissionService.checkAddressBookAccess(
        addressBook.guid,
        member.guid,
        ShareRule.FULL_CONTROL,
      ),
    ).resolves.toMatchObject({ guid: addressBook.guid });
    await expect(
      permissionService.checkAddressBookAccess(
        addressBook.guid,
        outsider.guid,
        ShareRule.READ_WRITE,
      ),
    ).resolves.toMatchObject({ guid: addressBook.guid });
    await expect(
      permissionService.checkAddressBookAccess(
        addressBook.guid,
        outsider.guid,
        ShareRule.FULL_CONTROL,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await userGroupService.moveUsers(guests.guid, [member.guid]);
    await expect(
      permissionService.checkAddressBookAccess(
        addressBook.guid,
        member.guid,
        ShareRule.FULL_CONTROL,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      permissionService.checkAddressBookAccess(
        addressBook.guid,
        member.guid,
        ShareRule.READ_WRITE,
      ),
    ).resolves.toMatchObject({ guid: addressBook.guid });
  });

  it('validates group rules and aggregates shared address books without duplicates', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const operators = await userGroupService.createGroup({
      name: 'Rule operators',
    });
    const guests = await userGroupService.createGroup({ name: 'Rule guests' });
    const owner = await createUser('rule-owner', defaultGroup.guid);
    const member = await createUser('rule-member', operators.guid);
    const outsider = await createUser('rule-outsider', guests.guid);
    const addressBook = await createAddressBook(owner.guid, 'Rule book');

    await ruleService.createRule(
      {
        guid: addressBook.guid,
        group: operators.guid,
        rule: ShareRule.FULL_CONTROL,
      },
      owner.guid,
    );
    await ruleService.createRule(
      { guid: addressBook.guid, rule: ShareRule.READ },
      owner.guid,
    );

    await expect(
      ruleService.createRule(
        {
          guid: addressBook.guid,
          group: operators.guid,
          rule: ShareRule.READ,
        },
        owner.guid,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      ruleService.createRule(
        {
          guid: addressBook.guid,
          group: randomUUID(),
          rule: ShareRule.READ,
        },
        owner.guid,
      ),
    ).rejects.toThrow('用户组不存在');

    const memberBooks = await ruleService.getSharedAddressBooks(member.guid, {
      current: 1,
      pageSize: 20,
    });
    expect(memberBooks).toMatchObject({
      total: 1,
      data: [{ guid: addressBook.guid, rule: ShareRule.FULL_CONTROL }],
    });

    const outsiderBooks = await ruleService.getSharedAddressBooks(
      outsider.guid,
      { current: 1, pageSize: 20, name: 'Rule' },
    );
    expect(outsiderBooks).toMatchObject({
      total: 1,
      data: [{ guid: addressBook.guid, rule: ShareRule.READ }],
    });

    await userGroupService.moveUsers(guests.guid, [member.guid]);
    const movedMemberBooks = await ruleService.getSharedAddressBooks(
      member.guid,
      { current: 1, pageSize: 20 },
    );
    expect(movedMemberBooks.data[0].rule).toBe(ShareRule.READ);
  });

  it('separates private, shared, and protocol address book profiles', async () => {
    const defaultGroup = await userGroupService.initializeStorage();
    const operators = await userGroupService.createGroup({
      name: 'Address book operators',
    });
    const owner = await createUser('profile-owner', defaultGroup.guid);
    const member = await createUser('profile-member', operators.guid);

    const privateGuid = await ruleService.addCustomAddressBook(
      'Private operations',
      owner.guid,
    );
    const sharedGuid = await ruleService.addSharedAddressBook(
      'Managed shared',
      owner.guid,
    );
    await ruleService.createRule(
      {
        guid: sharedGuid,
        group: operators.guid,
        rule: ShareRule.READ_WRITE,
      },
      owner.guid,
    );

    const legacyShared = await createAddressBook(owner.guid, 'Legacy shared');
    await createRule(legacyShared.guid, null, operators.guid, ShareRule.READ);

    const privateProfiles = await ruleService.getCustomAddressBooks(
      owner.guid,
      { current: 1, pageSize: 20 },
    );
    expect(privateProfiles.data.map((book) => book.guid)).toEqual([
      privateGuid,
    ]);

    const ownerSharedProfiles = await ruleService.getWebSharedAddressBooks(
      owner.guid,
      { current: 1, pageSize: 20 },
    );
    expect(
      ownerSharedProfiles.data.map((book) => [book.guid, book.is_owner]),
    ).toEqual([
      [legacyShared.guid, true],
      [sharedGuid, true],
    ]);

    const memberSharedProfiles = await ruleService.getWebSharedAddressBooks(
      member.guid,
      { current: 1, pageSize: 20 },
    );
    expect(
      memberSharedProfiles.data.map((book) => [book.guid, book.is_owner]),
    ).toEqual([
      [legacyShared.guid, false],
      [sharedGuid, false],
    ]);

    const ownerProtocolProfiles = await ruleService.getSharedAddressBooks(
      owner.guid,
      { current: 1, pageSize: 20 },
    );
    expect(ownerProtocolProfiles.data.map((book) => book.guid)).toEqual([
      legacyShared.guid,
      sharedGuid,
      privateGuid,
    ]);

    await ruleService.updateCustomAddressBook(
      privateGuid,
      owner.guid,
      'Private renamed',
    );
    await expect(
      ruleService.updateCustomAddressBook(
        sharedGuid,
        owner.guid,
        'Not allowed here',
      ),
    ).rejects.toThrow('私有自定义地址簿不存在');
    await ruleService.deleteCustomAddressBooks([privateGuid], owner.guid);
    expect(
      await addressBookRepository.findOneBy({ guid: privateGuid }),
    ).toBeNull();
  });

  it('publishes validated DTOs and protects every user-group route with AdminGuard', async () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      UserGroupController,
    ) as unknown[];
    expect(guards).toContain(AdminGuard);

    const validLegacyCreate = plainToInstance(CreateUserDto, {
      name: 'new-user',
      password: 'test-password',
      group_name: 'legacy-value',
      user_group_guid: randomUUID(),
    });
    expect(await validate(validLegacyCreate)).toHaveLength(0);

    const rustDeskGroupQuery = plainToInstance(UserQueryDto, {
      current: 1,
      pageSize: 100,
      accessible: '',
      status: '1',
    });
    expect(
      await validate(rustDeskGroupQuery, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);

    const invalidMembers = plainToInstance(UserGroupMembersDto, {
      user_guids: ['not-a-uuid'],
    });
    expect(await validate(invalidMembers)).not.toHaveLength(0);

    const oversizedPage = plainToInstance(UserGroupQueryDto, {
      current: 1,
      pageSize: 101,
    });
    expect(await validate(oversizedPage)).not.toHaveLength(0);

    const invalidGroupRule = plainToInstance(CreateRuleDto, {
      guid: randomUUID(),
      group: 'not-a-uuid',
      rule: ShareRule.READ,
    });
    expect(await validate(invalidGroupRule)).not.toHaveLength(0);

    const invalidAddressBookDelete = plainToInstance(DeleteAddressBooksDto, {
      guids: ['not-a-uuid'],
    });
    expect(await validate(invalidAddressBookDelete)).not.toHaveLength(0);

    for (const methodName of [
      'addSharedAddressBook',
      'updateSharedAddressBook',
      'deleteSharedAddressBooks',
      'addRule',
      'updateRule',
      'deleteRules',
    ] as const) {
      const method = AddressBookController.prototype[methodName];
      const methodGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        method,
      ) as unknown[];
      expect(methodGuards).toContain(AdminGuard);
    }
  });

  it('serves the existing frontend CRUD contract under /api/user-groups', async () => {
    await userGroupService.initializeStorage();
    const moduleRef = await Test.createTestingModule({
      controllers: [UserGroupController],
      providers: [
        { provide: UserGroupService, useValue: userGroupService },
        AdminGuard,
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    const httpServer = app.getHttpServer() as unknown as Server;

    try {
      const created = await request(httpServer)
        .post('/api/user-groups')
        .send({ name: 'Frontend group', note: 'Created through HTTP' })
        .expect(200);
      const createdBody = created.body as unknown as UserGroupHttpBody;

      expect(createdBody).toMatchObject({
        name: 'Frontend group',
        note: 'Created through HTTP',
        user_count: 0,
      });

      const listed = await request(httpServer)
        .get('/api/user-groups')
        .query({ current: 1, pageSize: 20, search: 'frontend' })
        .expect(200);
      const listedBody = listed.body as unknown as UserGroupListHttpBody;
      expect(listedBody).toMatchObject({
        total: 1,
        data: [{ guid: createdBody.guid, name: 'Frontend group' }],
      });

      await request(httpServer)
        .put(`/api/user-groups/${createdBody.guid}`)
        .send({ note: 'Updated through HTTP' })
        .expect(200)
        .expect((response) => {
          const responseBody = response.body as unknown as UserGroupHttpBody;
          expect(responseBody.note).toBe('Updated through HTTP');
        });

      await request(httpServer)
        .get('/api/user-groups')
        .query({ current: 0, pageSize: 20 })
        .expect(400);
      await request(httpServer)
        .post('/api/user-groups')
        .send({ name: 'Rejected', unknown: true })
        .expect(400);
      await request(httpServer)
        .delete(`/api/user-groups/${createdBody.guid}`)
        .expect(200);
    } finally {
      await app.close();
    }
  });
});
