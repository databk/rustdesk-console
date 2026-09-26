import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { GeneralSettingsService } from './services/general-settings.service';

/**
 * Frontend page settings controller
 * Returns only the minimal settings needed for frontend rendering; publicly readable
 */
@Controller('settings/frontend')
export class FrontendSettingsController {
  constructor(
    private readonly generalSettingsService: GeneralSettingsService,
  ) {}

  @Public()
  @Get()
  getSettings() {
    return this.generalSettingsService.getFrontendSettings();
  }
}
