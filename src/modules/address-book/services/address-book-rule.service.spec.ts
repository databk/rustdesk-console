import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AddressBookController } from '../address-book.controller';
import { AddressBook, AddressBookRule, ShareRule } from '../entities';
import { User } from '../../user/entities/user.entity';
import { UserGroup } from '../../user-group/entities/user-group.entity';
import { REQUIRE_PERMISSION_KEY } from '../../rbac/decorators/require-permission.decorator';
import { AddressBookPermissionService } from './address-book-permission.service';
import { AddressBookRuleService } from './address-book-rule.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

describe('Address-book share candidates', () => {
  const ruleRepository = { count: jest.fn(), find: jest.fn() };
  const userRepository = { find: jest.fn() };
  const userGroupRepository = { find: jest.fn() };
  const permissionService = { checkAddressBookAccess: jest.fn() };
  const service = new AddressBookRuleService(
    ruleRepository as unknown as Repository<AddressBookRule>,
    {} as Repository<AddressBook>,
    userRepository as unknown as Repository<User>,
    userGroupRepository as unknown as Repository<UserGroup>,
    permissionService as unknown as AddressBookPermissionService,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    permissionService.checkAddressBookAccess.mockResolvedValue({});
  });

  it('returns names only for principals already assigned to a rule', async () => {
    ruleRepository.count.mockResolvedValue(2);
    ruleRepository.find.mockResolvedValue([
      {
        guid: 'rule-user',
        addressBookGuid: 'book-1',
        targetUserId: 'user-1',
        targetGroupId: null,
        rule: 1,
        ruleType: 'user',
      },
      {
        guid: 'rule-group',
        addressBookGuid: 'book-1',
        targetUserId: null,
        targetGroupId: 'group-1',
        rule: 2,
        ruleType: 'group',
      },
    ]);
    userRepository.find.mockResolvedValue([
      { guid: 'user-1', username: 'alice', displayName: 'Alice' },
    ]);
    userGroupRepository.find.mockResolvedValue([
      { guid: 'group-1', name: 'Operators' },
    ]);

    const result = await service.getRules({ ab: 'book-1' }, 'actor');

    expect(result.data).toEqual([
      expect.objectContaining({
        user: 'user-1',
        target: { name: 'alice', display_name: 'Alice' },
      }),
      expect.objectContaining({
        group: 'group-1',
        target: { name: 'Operators' },
      }),
    ]);
  });

  it('guards the address-book-owned endpoint with address_books.share', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        AddressBookController.prototype.getShareCandidates,
      ),
    ).toEqual(['address_books.share']);
  });

  it('checks full-control ACL and returns only selector fields', async () => {
    userRepository.find.mockResolvedValue([
      {
        guid: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        email: 'secret@example.com',
        status: 1,
      },
    ]);
    userGroupRepository.find.mockResolvedValue([
      { guid: 'group-1', name: 'Operators', note: 'not exposed' },
    ]);

    const result = await service.getShareCandidates('book-1', 'actor');

    expect(permissionService.checkAddressBookAccess).toHaveBeenCalledWith(
      'book-1',
      'actor',
      ShareRule.FULL_CONTROL,
    );
    expect(result).toEqual({
      users: [{ guid: 'user-1', name: 'alice', display_name: 'Alice' }],
      groups: [{ guid: 'group-1', name: 'Operators' }],
    });
    expect(JSON.stringify(result)).not.toContain('secret@example.com');
    expect(JSON.stringify(result)).not.toContain('not exposed');
  });

  it('does not load candidates after an object-ACL denial', async () => {
    permissionService.checkAddressBookAccess.mockRejectedValue(
      new ForbiddenException('Full control permission required'),
    );

    await expect(
      service.getShareCandidates('book-1', 'actor'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepository.find).not.toHaveBeenCalled();
    expect(userGroupRepository.find).not.toHaveBeenCalled();
  });
});
