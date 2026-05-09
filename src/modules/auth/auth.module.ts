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
  TokenCleanupService,
} from './services';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { Peer } from '../../common/entities';
import { EmailVerificationSession } from './entities/email-verification-session.entity';
import { EmailModule } from '../email/email.module';

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
    TypeOrmModule.forFeature([User, UserToken, Peer, EmailVerificationSession]),
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret:
        process.env.JWT_SECRET ||
        'rustdesk-api-secret-key-change-in-production',
      signOptions: {
        expiresIn: '30d', // Token 有效期 30 天
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
    TokenCleanupService,
    JwtStrategy,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
