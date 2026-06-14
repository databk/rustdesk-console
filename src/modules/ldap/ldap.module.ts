import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { User } from '../user/entities/user.entity';
import { LdapController } from './ldap.controller';
import { LdapService } from './ldap.service';
import { LdapSettingsService } from './ldap-settings.service';

/**
 * LDAP 认证模块
 * 提供 LDAP 身份验证功能
 *
 * 导入模块：
 * - TypeOrmModule（SystemSetting、User）
 *
 * 导出服务：
 * - LdapService（供 AuthModule 集成 LDAP 认证）
 * - LdapSettingsService（供其他模块读取 LDAP 配置）
 */
@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting, User])],
  controllers: [LdapController],
  providers: [LdapService, LdapSettingsService],
  exports: [LdapService, LdapSettingsService],
})
export class LdapModule {}
