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
import { UpdateGeneralSettingsDto } from './dto/general-settings.dto';
import { GeneralSettingsService } from './services/general-settings.service';

@Controller('settings/general')
export class GeneralSettingsController {
  constructor(
    private readonly generalSettingsService: GeneralSettingsService,
  ) {}

  @Get()
  @UseGuards(AdminGuard)
  getSettings() {
    return this.generalSettingsService.getSettings();
  }

  @Put()
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() dto: UpdateGeneralSettingsDto) {
    return this.generalSettingsService.updateSettings(dto);
  }
}
