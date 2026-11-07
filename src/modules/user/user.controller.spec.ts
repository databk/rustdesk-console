import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserStatus } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

describe('UserController field-owned updates', () => {
  const userService = { updateUser: jest.fn(), acceptInvitation: jest.fn() };
  const authorizationService = { assertUserMutation: jest.fn() };
  const auditService = { record: jest.fn(), recordDenied: jest.fn() };
  const controller = new UserController(
    userService as unknown as UserService,
    authorizationService as unknown as RbacAuthorizationService,
    auditService as unknown as RbacAuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    authorizationService.assertUserMutation.mockResolvedValue(undefined);
    userService.updateUser.mockResolvedValue({ message: 'ok' });
    userService.acceptInvitation.mockResolvedValue({
      message: 'Account activated, please log in',
      userGuid: 'activated-user',
    });
    auditService.record.mockResolvedValue(undefined);
    auditService.recordDenied.mockResolvedValue(undefined);
  });

  it('allows a status-only update without requiring users.edit', async () => {
    await controller.updateUser(
      'target',
      { status: UserStatus.DISABLED },
      'actor',
    );

    expect(authorizationService.assertUserMutation).toHaveBeenCalledTimes(1);
    expect(authorizationService.assertUserMutation).toHaveBeenCalledWith(
      'actor',
      'target',
      'users.status',
    );
  });

  it('checks each permission before applying a combined update', async () => {
    await controller.updateUser(
      'target',
      {
        display_name: 'Display name',
        user_group_guid: '3d2bedb2-537f-4ac4-b916-89b5b272aacb',
      },
      'actor',
    );

    expect(authorizationService.assertUserMutation).toHaveBeenNthCalledWith(
      1,
      'actor',
      'target',
      'users.edit',
    );
    expect(authorizationService.assertUserMutation).toHaveBeenNthCalledWith(
      2,
      'actor',
      'target',
      'user_groups.membership',
    );
    expect(userService.updateUser).toHaveBeenCalledTimes(1);
  });

  it('does not apply a combined update when any field permission is denied', async () => {
    authorizationService.assertUserMutation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());

    await expect(
      controller.updateUser(
        'target',
        {
          display_name: 'Display name',
          status: UserStatus.DISABLED,
        },
        'actor',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('rejects an empty update before writing', async () => {
    await expect(
      controller.updateUser('target', {}, 'actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('passes the stable actor guid into the service write boundary', async () => {
    await controller.updateUser('target', { note: 'updated' }, 'actor-guid');
    expect(userService.updateUser).toHaveBeenCalledWith(
      'target',
      { note: 'updated' },
      'actor-guid',
    );
  });

  it('audits anonymous invitation acceptance with the activated user GUID', async () => {
    await expect(
      controller.acceptInvitation({
        token: 'invite-token',
        password: 'secret-1',
      }),
    ).resolves.toEqual({ message: 'Account activated, please log in' });
    expect(auditService.record).toHaveBeenCalledWith({
      targetType: 'user',
      targetGuid: 'activated-user',
      action: 'user.invitation.accept',
      result: 'allowed',
    });
  });
});
