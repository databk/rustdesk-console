import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
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
} from './services';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { Peer } from '../../common/entities';
import { LoginSession } from './entities/login-session.entity';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { EmailModule } from '../email/email.module';
import { LdapModule } from '../ldap/ldap.module';
import { UserGroupModule } from '../user-group/user-group.module';
import { SettingsModule } from '../settings/settings.module';
import { JWT_DEFAULT_SECRET, TOKEN_EXPIRY_DAYS } from './auth.constants';
import { RbacModule } from '../rbac/rbac.module';

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
    ]),
    EmailModule,
    LdapModule,
    UserGroupModule,
    SettingsModule,
    RbacModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || JWT_DEFAULT_SECRET,
      signOptions: {
        expiresIn: `${TOKEN_EXPIRY_DAYS}d`,
      },
    }),
  ],
  controllers: [AuthController],
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
    JwtStrategy,
  ],
  exports: [AuthService, AuthTokenService, AuthDeviceService, JwtModule],
})
export class AuthModule {}
