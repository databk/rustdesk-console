import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule, DataSource } from '@nestjs/typeorm';
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
 *   1. JWT_SECRET env var
 *   2. DB-persisted value (system_settings.auth.jwt.secret)
 *   3. Auto-generated random secret, persisted to DB
 *
 * Exposed as module-level function so JwtStrategy (synchronous constructor)
 * can read it via getCachedJwtSecret().
 */
let cachedSecret: string | undefined;
export function getCachedJwtSecret(): string {
  return cachedSecret ?? '';
}

async function resolveSecret(dataSource: DataSource): Promise<string> {
  // Priority 1: env var
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    cachedSecret = process.env.JWT_SECRET.trim();
    return cachedSecret;
  }

  // Priority 2: DB-persisted
  try {
    const repo = dataSource.getRepository(SystemSetting);
    const row = await repo.findOne({ where: { key: 'auth.jwt.secret' } });
    if (row?.value && row.value.length >= 16) {
      cachedSecret = row.value;
      return cachedSecret;
    }
  } catch {
    // DB might not be ready yet on very first call; fall through to gen
  }

  // Priority 3: generate random + persist
  cachedSecret = randomBytes(48).toString('base64');
  try {
    await dataSource.getRepository(SystemSetting).save({
      key: 'auth.jwt.secret',
      value: cachedSecret,
      category: 'auth',
      description: 'Auto-generated JWT signing secret. Shared with hbbs RD_MANAGEMENT_TOKEN.',
      isSensitive: true,
    });
  } catch {
    // Best-effort persistence; keep the secret in memory
  }
  return cachedSecret;
}

/**
 * Auth module
 *
 * JwtModule.registerAsync 用 inject: [DataSource] 来拿全局 TypeORM
 * 连接，避免嵌套的 forFeature 在 DataSource 还没初始化时就被 resolve。
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
      SystemSetting,
    ]),
    EmailModule,
    LdapModule,
    UserGroupModule,
    SettingsModule,
    RbacModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [DataSource],
      useFactory: async (dataSource: DataSource) => {
        const secret = await resolveSecret(dataSource);
        return {
          secret,
          signOptions: {
            expiresIn: `${TOKEN_EXPIRY_DAYS}d`,
          },
        };
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
