import 'reflect-metadata';
import { AuthResponseHelper } from './auth-response.helper';
import { User, UserStatus } from '../../user/entities/user.entity';

function buildUser(): User {
  const user = new User();
  user.guid = 'user-guid';
  user.username = 'alice';
  user.displayName = null;
  user.email = 'alice@example.com';
  user.status = UserStatus.ACTIVE;
  user.isAdmin = false;
  user.avatar = null;
  return user;
}

/** 模拟 select:false 敏感字段未被查询时的实体状态 */
function withoutSensitiveFields(user: User): User {
  delete (user as unknown as Record<string, unknown>).tfaSecret;
  delete (user as unknown as Record<string, unknown>).password;
  delete (user as unknown as Record<string, unknown>).verifier;
  return user;
}

describe('AuthResponseHelper', () => {
  const helper = new AuthResponseHelper();

  describe('buildCurrentUserPayload', () => {
    it('reports 2FA as enabled when a TOTP secret is stored', () => {
      const user = buildUser();
      user.tfaSecret = 'BASE32SECRET';
      user.password = 'hashed';

      const payload = helper.buildCurrentUserPayload(user);

      expect(payload.tfa_enabled).toBe(true);
      expect(payload.has_password).toBe(true);
      expect(payload).not.toHaveProperty('tfaSecret');
      expect(payload).not.toHaveProperty('password');
    });

    it('reports 2FA as disabled when no TOTP secret is stored', () => {
      const user = buildUser();
      user.tfaSecret = '';
      user.password = null as unknown as string;

      const payload = helper.buildCurrentUserPayload(user);

      expect(payload.tfa_enabled).toBe(false);
      expect(payload.has_password).toBe(false);
    });
  });

  describe('buildUserPayload', () => {
    it('includes 2FA state only when the secret field was loaded', () => {
      const withSecret = buildUser();
      withSecret.tfaSecret = 'BASE32SECRET';

      expect(helper.buildUserPayload(withSecret).tfa_enabled).toBe(true);
      expect(
        helper.buildUserPayload(withoutSensitiveFields(buildUser())),
      ).not.toHaveProperty('tfa_enabled');
    });

    it('includes password state only when the password field was loaded', () => {
      const withPassword = buildUser();
      withPassword.password = 'hashed';

      expect(helper.buildUserPayload(withPassword).has_password).toBe(true);
      expect(
        helper.buildUserPayload(withoutSensitiveFields(buildUser())),
      ).not.toHaveProperty('has_password');
    });

    it('never exposes the TOTP secret or the password hash', () => {
      const user = buildUser();
      user.tfaSecret = 'BASE32SECRET';
      user.password = 'hashed';

      const payload = helper.buildUserPayload(user);

      expect(JSON.stringify(payload)).not.toContain('BASE32SECRET');
      expect(JSON.stringify(payload)).not.toContain('hashed');
    });
  });
});
