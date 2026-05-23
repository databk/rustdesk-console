import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { OidcProvider } from './entities/oidc-provider.entity';
import { OidcAuthState } from './entities/oidc-auth-state.entity';
import { User } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * OIDC模块
 * 负责OpenID Connect第三方登录集成
 *
 * 导入模块：
 * - TypeOrmModule
 * - ConfigModule
 *
 * 导出服务：
 * - OidcService
 *
 * 提供服务：
 * - OidcService
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OidcProvider, OidcAuthState, User, UserToken]),
    AuthModule,
    ConfigModule,
  ],
  controllers: [OidcController],
  providers: [OidcService],
  exports: [OidcService],
})
export class OidcModule {}
