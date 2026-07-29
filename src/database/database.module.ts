import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../modules/user/entities/user.entity';
import { UserToken } from '../modules/user/entities/user-token.entity';
import { OidcProvider } from '../modules/oidc/entities/oidc-provider.entity';
import { OidcAuthState } from '../modules/oidc/entities/oidc-auth-state.entity';
import { SystemSetting } from '../modules/settings/entities/system-setting.entity';
import { DatabaseInitService } from './database-init.service';
import { MigrationService } from './migration.service';
import { UserGroupModule } from '../modules/user-group/user-group.module';

@Global()
/**
 * 数据库模块
 * 负责数据库连接和初始化配置
 *
 * 提供服务：
 * - MigrationService - 生产环境数据库迁移执行
 * - DatabaseInitService - 种子数据初始化
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserToken,
      OidcProvider,
      OidcAuthState,
      SystemSetting,
    ]),
    UserGroupModule,
  ],
  providers: [MigrationService, DatabaseInitService],
  exports: [MigrationService, DatabaseInitService],
})
export class DatabaseModule {}
