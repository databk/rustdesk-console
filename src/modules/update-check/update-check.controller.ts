import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UpdateCheckService } from './update-check.service';

/**
 * Update check controller
 *
 * Endpoints:
 * - GET /api/update-check - Get cached update check result (admin)
 */
@Controller('update-check')
export class UpdateCheckController {
  constructor(private readonly updateCheckService: UpdateCheckService) {}

  /**
   * Get cached update check result
   * The backend automatically checks for updates every hour; the frontend request returns the cache directly
   */
  @Get()
  @UseGuards(AdminGuard)
  async checkUpdate(@Query('frontend_version') frontendVersion?: string) {
    return this.updateCheckService.checkUpdate(frontendVersion);
  }
}
