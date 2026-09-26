import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireSuperAdmin } from '../rbac/decorators/require-permission.decorator';
import {
  DashboardDataDto,
  DashboardTrendsDto,
} from './dto/dashboard-overview.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@RequireSuperAdmin()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async getDashboard(): Promise<DashboardDataDto> {
    return this.dashboardService.getDashboard();
  }

  @Get('trends')
  async getTrends(@Query('range') range?: string): Promise<DashboardTrendsDto> {
    return this.dashboardService.getTrends(range);
  }
}
