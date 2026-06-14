import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../../common/guards/admin.guard';
import { LdapSettingsService } from './ldap-settings.service';
import { LdapService } from './ldap.service';
import { UpdateLdapConfigDto, TestLdapConfigDto } from './dto/ldap-config.dto';

/**
 * LDAP 配置控制器
 * 管理 LDAP 配置相关的 API 接口
 *
 * 端点：
 * - GET  /api/settings/ldap      - 获取 LDAP 配置
 * - PUT  /api/settings/ldap      - 创建或更新 LDAP 配置（Upsert）
 * - POST /api/settings/ldap/test - 测试 LDAP 连接
 *
 * 所有端点需要管理员权限
 */
@UseGuards(AdminGuard)
@Controller('settings/ldap')
export class LdapController {
  constructor(
    private readonly ldapSettingsService: LdapSettingsService,
    private readonly ldapService: LdapService,
  ) {}

  /**
   * 获取 LDAP 配置
   * 返回当前生效的 LDAP 配置，密码字段脱敏
   */
  @Get()
  async getLdapConfig() {
    return this.ldapSettingsService.getLdapConfig();
  }

  /**
   * 创建或更新 LDAP 配置（Upsert 语义）
   * 配置不存在时创建，存在时更新
   * 仅更新传入的字段，密码字段传入占位符时不更新
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  async updateLdapConfig(@Body() dto: UpdateLdapConfigDto) {
    return this.ldapSettingsService.updateLdapConfig(dto);
  }

  /**
   * 测试 LDAP 连接
   * 可传入配置进行测试，不传则测试当前生效配置
   *
   * 限流：每分钟最多5次，防止滥用
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async testLdapConnection(@Body() dto?: TestLdapConfigDto) {
    if (dto && dto.urls && dto.urls.length > 0) {
      return this.ldapService.testConnection({
        urls: dto.urls,
        bindDN: dto.bindDN || '',
        bindCredentials: dto.bindCredentials || '',
        searchBase: dto.searchBase || '',
        searchFilter: dto.searchFilter || '(sAMAccountName={{username}})',
        searchAttributes: ['dn', 'sAMAccountName', 'mail', 'displayName'],
        groupSearchBase: '',
        groupSearchFilter: '',
        adminGroups: [],
        tlsOptions: {},
        enabled: true,
      });
    }
    return this.ldapService.testConnection();
  }
}
