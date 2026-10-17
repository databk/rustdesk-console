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
import { UpdateServerManagementSettingsDto } from './dto/server-management-settings.dto';
import { ServerEventsService } from './server-events.service';
import { ServerManagementSettingsService } from './server-management-settings.service';

/**
 * Server management settings controller
 *
 * Number of endpoints: 2
 * - GET /api/settings/server-management - Get server management configuration
 * - PUT /api/settings/server-management - Create or update server management configuration (Upsert)
 *
 * All endpoints require administrator permission
 */
@UseGuards(AdminGuard)
@Controller('settings/server-management')
export class ServerManagementSettingsController {
  constructor(
    private readonly settings: ServerManagementSettingsService,
    private readonly events: ServerEventsService,
  ) {}

  /**
   * Get server management configuration (token masked)
   */
  @Get()
  getSettings() {
    return this.settings.getSettings();
  }

  /**
   * Create or update server management configuration (Upsert semantics)
   * The event stream reconnects immediately with the new configuration
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  async updateSettings(@Body() dto: UpdateServerManagementSettingsDto) {
    const result = await this.settings.updateSettings(dto);
    this.events.restart();
    return result;
  }
}
