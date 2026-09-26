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
 * LDAP configuration controller
 * Manages LDAP configuration related API endpoints
 *
 * Endpoints:
 * - GET  /api/settings/ldap      - Get LDAP configuration
 * - PUT  /api/settings/ldap      - Create or update LDAP configuration (Upsert)
 * - POST /api/settings/ldap/test - Test LDAP connection
 *
 * All endpoints require administrator permission
 */
@UseGuards(AdminGuard)
@Controller('settings/ldap')
export class LdapController {
  constructor(
    private readonly ldapSettingsService: LdapSettingsService,
    private readonly ldapService: LdapService,
  ) {}

  /**
   * Get LDAP configuration
   * Returns the currently active LDAP configuration with the password field masked
   */
  @Get()
  async getLdapConfig() {
    return this.ldapSettingsService.getLdapConfig();
  }

  /**
   * Create or update LDAP configuration (Upsert semantics)
   * Creates the configuration if it does not exist, updates it otherwise
   * Only updates the provided fields; the password is not updated when the placeholder is passed
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  async updateLdapConfig(@Body() dto: UpdateLdapConfigDto) {
    return this.ldapSettingsService.updateLdapConfig(dto);
  }

  /**
   * Test LDAP connection
   * A configuration may be provided for testing; if omitted, the currently active configuration is tested
   *
   * Rate limit: at most 5 requests per minute to prevent abuse
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async testLdapConnection(@Body() dto?: TestLdapConfigDto) {
    if (dto && dto.urls && dto.urls.length > 0) {
      // Get saved config to fall back for fields not provided in DTO (e.g. bindCredentials)
      const savedConfig = await this.ldapSettingsService.getActiveConfig();
      const bindCredentials =
        dto.bindCredentials || savedConfig?.bindCredentials || '';

      return this.ldapService.testConnection({
        urls: dto.urls,
        bindDN: dto.bindDN || savedConfig?.bindDN || '',
        bindCredentials,
        searchBase: dto.searchBase || savedConfig?.searchBase || '',
        searchFilter:
          dto.searchFilter ||
          savedConfig?.searchFilter ||
          '(sAMAccountName={{username}})',
        searchAttributes: savedConfig?.searchAttributes || [
          'dn',
          'sAMAccountName',
          'mail',
          'displayName',
        ],
        groupSearchBase: savedConfig?.groupSearchBase || '',
        groupSearchFilter: savedConfig?.groupSearchFilter || '',
        adminGroups: savedConfig?.adminGroups || [],
        tlsOptions: savedConfig?.tlsOptions || {},
        enabled: true,
      });
    }
    return this.ldapService.testConnection();
  }
}
