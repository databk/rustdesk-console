import 'reflect-metadata';
import * as crypto from 'crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { User, UserStatus } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { LoginSession } from '../entities/login-session.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';

/** Wait for fire-and-forget email dispatch to settle */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildActiveUser(): User {
  const user = new User();
  user.guid = 'user-guid';
  user.username = 'alice';
  user.displayName = 'Alice';
  user.email = 'alice@example.com';
  user.status = UserStatus.ACTIVE;

  return user;
}

function buildTokenRecord(overrides: Partial<PasswordResetToken> = {}) {
  const record = new PasswordResetToken();
  record.guid = 'record-guid';
  record.token = 'reset-token';
  record.userGuid = 'user-guid';
  record.expiresAt = new Date(Date.now() + 60 * 1000);
  record.usedAt = null;
  return Object.assign(record, overrides);
}

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let passwordResetTokenRepository: Record<string, jest.Mock>;
  let userTokenRepository: Record<string, jest.Mock>;
  let loginSessionRepository: Record<string, jest.Mock>;
  let userRepository: Record<string, jest.Mock>;
  let authUserHelper: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let generalSettingsService: Record<string, jest.Mock>;
  let smtpSettingsService: Record<string, jest.Mock>;
  let manager: { getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    passwordResetTokenRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };
    userTokenRepository = { update: jest.fn() };
    loginSessionRepository = { delete: jest.fn() };
    userRepository = { findOne: jest.fn(), save: jest.fn() };
    authUserHelper = {
      findByUsernameOrEmail: jest.fn(),
      findByGuid: jest.fn(),
    };
    emailService = { sendPasswordResetEmail: jest.fn() };
    generalSettingsService = {
      getSiteSettings: jest.fn().mockResolvedValue({
        effectiveFrontendUrl: 'http://localhost:3000',
      }),
    };
    smtpSettingsService = {
      getActiveConfig: jest.fn().mockResolvedValue({ host: 'smtp.test' }),
    };
    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === PasswordResetToken) return passwordResetTokenRepository;
        if (entity === UserToken) return userTokenRepository;
        if (entity === LoginSession) return loginSessionRepository;
        if (entity === User) return userRepository;
        return {};
      }),
    };
    dataSource = {
      transaction: jest.fn((callback: (m: unknown) => Promise<unknown>) =>
        callback(manager),
      ),
    };
    service = new PasswordResetService(
      passwordResetTokenRepository as never,
      userTokenRepository as never,
      loginSessionRepository as never,
      authUserHelper as never,
      emailService as never,
      generalSettingsService as never,
      smtpSettingsService as never,
      dataSource as never,
    );
  });

  describe('requestReset', () => {
    it('rejects when SMTP is not enabled', async () => {
      smtpSettingsService.getActiveConfig.mockResolvedValue(null);

      await expect(
        service.requestReset({ username_or_email: 'alice' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the generic message without sending email when the user does not exist', async () => {
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(null);

      const result = await service.requestReset({
        username_or_email: 'nobody',
      });

      expect(result.message).toContain('If the account exists');
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(passwordResetTokenRepository.save).not.toHaveBeenCalled();
    });

    it('does not send email for users without an email address', async () => {
      const user = buildActiveUser();
      user.email = null;
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(user);

      await service.requestReset({ username_or_email: 'alice' });

      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does not send email for third-party auth users', async () => {
      const user = buildActiveUser();
      user.thirdAuthType = 'oidc';
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(user);

      await service.requestReset({ username_or_email: 'alice' });

      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does not send email for disabled users', async () => {
      const user = buildActiveUser();
      user.status = UserStatus.DISABLED;
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(user);

      await service.requestReset({ username_or_email: 'alice' });

      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('creates a token and sends the reset link for eligible users', async () => {
      const user = buildActiveUser();
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(user);
      emailService.sendPasswordResetEmail.mockResolvedValue(true);

      const result = await service.requestReset({
        username_or_email: 'alice',
      });
      await flushMicrotasks();

      expect(result.message).toContain('If the account exists');
      expect(passwordResetTokenRepository.delete).toHaveBeenCalledWith({
        userGuid: user.guid,
      });
      expect(passwordResetTokenRepository.save).toHaveBeenCalledTimes(1);
      const saved = passwordResetTokenRepository.save.mock.calls[0][0];
      expect(saved.userGuid).toBe(user.guid);
      expect(saved.token).toHaveLength(64);
      expect(saved.usedAt).toBeNull();
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [email, resetUrl] =
        emailService.sendPasswordResetEmail.mock.calls[0];
      expect(email).toBe('alice@example.com');
      expect(resetUrl).toContain(
        'http://localhost:3000/#/user/reset-password?token=',
      );
      const rawToken = resetUrl.split('token=')[1];
      expect(rawToken).toHaveLength(64);
      expect(saved.token).not.toBe(rawToken);
      expect(saved.token).toBe(hashToken(rawToken));
    });

    it('stores a SHA-256 digest that cannot be reversed into the link token', async () => {
      const user = buildActiveUser();
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(user);
      emailService.sendPasswordResetEmail.mockResolvedValue(true);

      await service.requestReset({ username_or_email: 'alice' });
      await flushMicrotasks();

      const saved = passwordResetTokenRepository.save.mock.calls[0][0];
      const [, resetUrl] = emailService.sendPasswordResetEmail.mock.calls[0];
      const rawToken = resetUrl.split('token=')[1];
      expect(saved.token).toMatch(/^[0-9a-f]{64}$/);
      expect(saved.token).not.toContain(rawToken);
    });

    it('returns the generic message when the email cannot be sent', async () => {
      const user = buildActiveUser();
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(user);
      emailService.sendPasswordResetEmail.mockResolvedValue(false);

      const result = await service.requestReset({
        username_or_email: 'alice',
      });
      await flushMicrotasks();

      expect(result.message).toContain('If the account exists');
    });

    it('returns the generic message when the email delivery rejects', async () => {
      const user = buildActiveUser();
      authUserHelper.findByUsernameOrEmail.mockResolvedValue(user);
      emailService.sendPasswordResetEmail.mockRejectedValue(
        new Error('SMTP connection refused'),
      );

      const result = await service.requestReset({
        username_or_email: 'alice',
      });
      await flushMicrotasks();

      expect(result.message).toContain('If the account exists');
    });
  });

  describe('validateResetToken', () => {
    it('rejects unknown tokens', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(null);

      await expect(service.validateResetToken('unknown')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects used tokens', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(
        buildTokenRecord({ usedAt: new Date() }),
      );

      await expect(service.validateResetToken('reset-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects expired tokens', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(
        buildTokenRecord({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.validateResetToken('reset-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns the account info for a valid token', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(
        buildTokenRecord(),
      );
      authUserHelper.findByGuid.mockResolvedValue(buildActiveUser());

      const result = await service.validateResetToken('reset-token');

      expect(result).toEqual({
        username: 'alice',
        display_name: 'Alice',
      });
    });
  });

  describe('confirmReset', () => {
    it('rejects unknown tokens', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(null);

      await expect(
        service.confirmReset({ token: 'unknown', new_password: 'secret1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects replayed tokens', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(
        buildTokenRecord(),
      );
      userRepository.findOne.mockResolvedValue(buildActiveUser());
      passwordResetTokenRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.confirmReset({
          token: 'reset-token',
          new_password: 'secret1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects inactive users', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(
        buildTokenRecord(),
      );
      const user = buildActiveUser();
      user.status = UserStatus.DISABLED;
      userRepository.findOne.mockResolvedValue(user);

      await expect(
        service.confirmReset({ token: 'reset-token', new_password: 'secret1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects third-party auth users', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(
        buildTokenRecord(),
      );
      const user = buildActiveUser();
      user.thirdAuthType = 'ldap';
      userRepository.findOne.mockResolvedValue(user);

      await expect(
        service.confirmReset({ token: 'reset-token', new_password: 'secret1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the password, consumes the token, and revokes sessions', async () => {
      const record = buildTokenRecord();
      passwordResetTokenRepository.findOne.mockResolvedValue(record);
      const user = buildActiveUser();
      userRepository.findOne.mockResolvedValue(user);
      passwordResetTokenRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.confirmReset({
        token: 'reset-token',
        new_password: 'new-secret',
      });

      expect(result.message).toBe('Password has been reset successfully');
      expect(result.username).toBe('alice');
      expect(user.password).not.toBe('new-secret');
      expect(user.password?.startsWith('$2')).toBe(true);
      expect(passwordResetTokenRepository.update).toHaveBeenCalledWith(
        { guid: record.guid, usedAt: expect.anything() },
        { usedAt: expect.any(Date) },
      );
      expect(userTokenRepository.update).toHaveBeenCalledWith(
        { userGuid: user.guid, isRevoked: false },
        { isRevoked: true },
      );
      expect(loginSessionRepository.delete).toHaveBeenCalledWith({
        userGuid: user.guid,
        used: false,
      });
    });
  });
});
