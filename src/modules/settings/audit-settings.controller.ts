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
import { UpdateAuditSettingsDto } from './dto/audit-settings.dto';
import { AuditSettingsService } from './services/audit-settings.service';

@Controller('settings/audit')
export class AuditSettingsController {
  constructor(
    private readonly auditSettingsService: AuditSettingsService,
  ) {}

  @Get()
  @UseGuards(AdminGuard)
  getSettings() {
    return this.auditSettingsService.getRetentionDays().then((retentionDays) => ({
      retentionDays,
    }));
  }

  @Put()
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async updateSettings(@Body() dto: UpdateAuditSettingsDto) {
    await this.auditSettingsService.setRetentionDays(dto.retentionDays);
    return { retentionDays: dto.retentionDays };
  }
}