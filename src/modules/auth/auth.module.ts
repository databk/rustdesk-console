import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { PasswordResetController } from './password-reset.controller';
import { randomBytes } from 'crypto';
import {
  AuthService,
  AuthTokenService,
  AuthTfaService,
  AuthEmailService,
  AuthDeviceService,
  AuthPasskeyService,
  WebAuthnConfigService,
  TokenCleanupService,
  AuthResponseHelper,
  LoginSessionService,
  AuthUserHelper,
  AuthLoginHelper,
  PasswordResetService,
} from './services';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { Peer } from '../../common/entities';
import { LoginSession } from './entities/login-session.entity';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailModule } from '../email/email.module';
import { LdapModule } from '../ldap/ldap.module';
import { UserGroupModule } from '../user-group/user-group.module';
import { SettingsModule } from '../settings/settings.module';
import { TOKEN_EXPIRY_DAYS } from './auth.constants';
import { RbacModule } from '../rbac/rbac.module';
import { SystemSetting } from '../settings/entities/system-setting.entity';

/**
 * Resolve JWT signing secret with three-tier priority:
 *   1. JWT_SECRET env var (Shell script service-setup generates one on first boot)
 *   2. DB-persisted value (system_settings.auth.jwt.secret)
 *   3. Hardcoded fallback (only if both above fail — unlikely in fnOS Native FPK)
 */
const JWT_SECRET_SETTING_KEY = 'auth.jwt.secret';
const HARDCODED_FALLBACK = 'rustdesk-api-secret-key-change-in-production';

function resolveJwtSecretSync(): string {
  // Priority 1: env var (Shell script generates this)
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    return process.env.JWT_SECRET.trim();
  }
  // Priority 3: hardcoded fallback
  return HARDCODED_FALLBACK;
}

const _resolvedSecret = resolveJwtSecretSync();
export function getCachedJwtSecret(): string {
  return _resolvedSecret;
}

/**
 * Auth module
 *
 * JwtModule stays static (register) not async (registerAsync) to avoid
 * module initialization ordering issues with DataSource injection.
 * Shell script layer (service-setup) already generates JWT_SECRET env var
 * on first install — see fnos-native/cmd/service-setup.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserToken,
      Peer,
      LoginSession,
      PasskeyCredential,
      PasswordResetToken,
      SystemSetting, // for on-init secret persistence
    ]),
    EmailModule,
    LdapModule,
    UserGroupModule,
    SettingsModule,
    RbacModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: _resolvedSecret,
      signOptions: {
        expiresIn: `${TOKEN_EXPIRY_DAYS}d`,
      },
    }),
  ],
  controllers: [AuthController, PasswordResetController],
  providers: [
    AuthService,
    AuthTokenService,
    AuthTfaService,
    AuthEmailService,
    AuthDeviceService,
    AuthPasskeyService,
    WebAuthnConfigService,
    TokenCleanupService,
    AuthResponseHelper,
    LoginSessionService,
    AuthUserHelper,
    AuthLoginHelper,
    PasswordResetService,
    JwtStrategy,
  ],
  exports: [AuthService, AuthTokenService, AuthDeviceService, JwtModule],
})
export class AuthModule {}
