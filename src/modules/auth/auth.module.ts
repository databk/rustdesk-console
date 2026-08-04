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
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { EmailModule } from '../email/email.module';
import { LdapModule } from '../ldap/ldap.module';
import { UserGroupModule } from '../user-group/user-group.module';
import { JWT_DEFAULT_SECRET } from './auth.constants';

/**
 * 认证模块
 * 负责用户认证、授权和令牌管理
 *
 * 导入模块：
 * - TypeOrmModule
 * - JwtModule
 * - MailerModule
 *
 * 导出服务：
 * - AuthService
 * - JwtStrategy
 *
 * 提供服务：
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
      SystemSetting,
    ]),
    EmailModule,
    LdapModule,
    UserGroupModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || JWT_DEFAULT_SECRET,
      signOptions: {
        expiresIn: '30d',
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
