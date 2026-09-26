import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SmtpSettingsService } from './services/smtp-settings.service';
import { UpdateSmtpConfigDto, TestSmtpConfigDto } from './dto/smtp-config.dto';

/**
 * System settings controller
 * Manages system configuration related API endpoints
 *
 * Number of endpoints: 3
 * - GET  /api/settings/smtp      - Get SMTP configuration
 * - PUT  /api/settings/smtp      - Create or update SMTP configuration (Upsert)
 * - POST /api/settings/smtp/test - Test SMTP connection
 *
 * All endpoints require administrator permission
 */
@UseGuards(AdminGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly smtpSettingsService: SmtpSettingsService) {}

  /**
   * Get SMTP configuration
   * Returns the currently active SMTP configuration with the password field masked
   * Returns 404 if the configuration does not exist
   */
  @Get('smtp')
  async getSmtpConfig() {
    return this.smtpSettingsService.getSmtpConfig();
  }

  /**
   * Create or update SMTP configuration (Upsert semantics)
   * Creates the configuration if it does not exist, updates it otherwise
   * Only updates the provided fields; the password is not updated when the placeholder is passed
   */
  @Put('smtp')
  @HttpCode(HttpStatus.OK)
  async updateSmtpConfig(@Body() dto: UpdateSmtpConfigDto) {
    return this.smtpSettingsService.updateSmtpConfig(dto);
  }

  /**
   * Test SMTP connection
   * A configuration may be provided for testing; if omitted, the currently active configuration is tested
   *
   * Rate limit: at most 5 requests per minute to prevent abuse
   */
  @Post('smtp/test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async testSmtpConnection(@Body() dto?: TestSmtpConfigDto) {
    return this.smtpSettingsService.testSmtpConnection(dto);
  }
}
