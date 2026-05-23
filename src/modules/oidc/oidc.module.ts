import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { OidcAuthStateCleanupService } from './oidc-auth-state-cleanup.service';
import { OidcProvider } from './entities/oidc-provider.entity';
import { OidcAuthState } from './entities/oidc-auth-state.entity';
import { User } from '../user/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * OIDC模块
 * 负责OpenID Connect第三方登录集成
 *
 * 导入模块：
 * - TypeOrmModule
 * - AuthModule（提供AuthTokenService）
 *
 * 导出服务：
 * - OidcService
 *
 * 提供服务：
 * - OidcService
 * - OidcAuthStateCleanupService（定时清理过期授权状态）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OidcProvider, OidcAuthState, User]),
    AuthModule,
  ],
  controllers: [OidcController],
  providers: [OidcService, OidcAuthStateCleanupService],
  exports: [OidcService],
})
export class OidcModule {}
