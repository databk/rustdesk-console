import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../modules/user/entities/user.entity';
import { UserToken } from '../modules/user/entities/user-token.entity';
import { OidcProvider } from '../modules/oidc/entities/oidc-provider.entity';
import { OidcAuthState } from '../modules/oidc/entities/oidc-auth-state.entity';
import { DatabaseInitService } from './database-init.service';

@Global()
/**
 * 数据库模块
 * 负责数据库连接和初始化配置
 *
 * 提供服务：
 * - DatabaseInitService
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserToken, OidcProvider, OidcAuthState]),
  ],
  providers: [DatabaseInitService],
  exports: [DatabaseInitService],
})
export class DatabaseModule {}
