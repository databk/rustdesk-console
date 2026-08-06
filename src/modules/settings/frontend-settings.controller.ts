import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { GeneralSettingsService } from './services/general-settings.service';

/**
 * 前端页面配置控制器
 * 仅返回前端渲染所需的精简配置，公开可读
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
