import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { User } from '../user/entities/user.entity';
import { LdapController } from './ldap.controller';
import { LdapService } from './ldap.service';
import { LdapSettingsService } from './ldap-settings.service';
import { UserGroupModule } from '../user-group/user-group.module';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * LDAP authentication module
 * Provides LDAP authentication
 *
 * Imported modules:
 * - TypeOrmModule(SystemSetting, User)
 *
 * Exported services:
 * - LdapService(for AuthModule to integrate LDAP authentication)
 * - LdapSettingsService(for other modules to read LDAP configuration)
 */
@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting, User]), UserGroupModule],
  controllers: [LdapController],
  providers: [LdapService, LdapSettingsService, AdminGuard],
  exports: [LdapService, LdapSettingsService],
})
export class LdapModule {}
