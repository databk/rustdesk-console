import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { PasswordResetController } from './password-reset.controller';
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
import { JwtSecretService } from './jwt-secret';
import { TOKEN_EXPIRY_DAYS } from './auth.constants';
import { RbacModule } from '../rbac/rbac.module';
import { SystemSetting } from '../settings/entities/system-setting.entity';

/**
 * Auth module
 * Handles user authentication, authorization, and token management
 *
 * Imported modules:
 * - TypeOrmModule
 * - JwtModule
 * - MailerModule
 *
 * Exported services:
 * - AuthService
 * - JwtStrategy
 *
 * Provided services:
 * - AuthService
 * - JwtStrategy
 * - JwtAuthGuard
 * - AdminGuard
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
      SystemSetting, // JwtSecretService 需要查 system_settings 表
    ]),
    EmailModule,
    LdapModule,
    UserGroupModule,
    SettingsModule,
    RbacModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [TypeOrmModule.forFeature([SystemSetting])],
      inject: [JwtSecretService],
      useFactory: async (jwtSecretService: JwtSecretService) => {
        const secret = await jwtSecretService.resolveSecret();
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
    JwtSecretService,
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
  exports: [AuthService, AuthTokenService, AuthDeviceService, JwtModule, JwtSecretService],
})
export class AuthModule {}
