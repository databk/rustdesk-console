import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UpdateWebClientSettingsDto } from './dto/web-client-settings.dto';
import { WebClientSettingsService } from './web-client-settings.service';
import { WebClientService } from './web-client.service';

/**
 * Web client settings controller
 *
 * Number of endpoints: 2
 * - GET /api/settings/web-client - Get web client configuration
 * - PUT /api/settings/web-client - Create or update web client configuration (Upsert)
 *
 * All endpoints require administrator permission
 */
@UseGuards(AdminGuard)
@Controller('settings/web-client')
export class WebClientSettingsController {
  constructor(
    private readonly settings: WebClientSettingsService,
    private readonly webClient: WebClientService,
  ) {}

  /**
   * Get web client configuration
   * Returns 404 if the configuration does not exist
   */
  @Get()
  getSettings() {
    return this.settings.getSettings();
  }

  /**
   * Create or update web client configuration (Upsert semantics)
   * The merged configuration must be valid when enabled
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  async updateSettings(@Body() dto: UpdateWebClientSettingsDto) {
    const result = await this.settings.updateSettings(dto);
    await this.webClient.refresh();
    return result;
  }
}
