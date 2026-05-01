import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DashboardOverviewDto,
  DashboardStatisticsDto,
  DashboardTrendsDto,
  DashboardRealtimeDto,
} from './dto/dashboard-overview.dto';

/**
 * Dashboard 控制器
 * 提供数据统计和分析接口
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * 获取总览数据
   * GET /api/dashboard/overview
   */
  @Get('overview')
  async getOverview(): Promise<DashboardOverviewDto> {
    return this.dashboardService.getOverview();
  }

  /**
   * 获取统计数据
   * GET /api/dashboard/statistics
   */
  @Get('statistics')
  async getStatistics(): Promise<DashboardStatisticsDto> {
    return this.dashboardService.getStatistics();
  }

  /**
   * 获取趋势数据
   * GET /api/dashboard/trends
   * @param range 时间范围 (7d, 30d, 90d)
   * @param metric 指标类型 (all, connection, user, device, alarm)
   */
  @Get('trends')
  async getTrends(
    @Query('range') range?: string,
    @Query('metric') metric?: string,
  ): Promise<DashboardTrendsDto> {
    return this.dashboardService.getTrends(range, metric);
  }

  /**
   * 获取实时数据
   * GET /api/dashboard/realtime
   */
  @Get('realtime')
  async getRealtime(): Promise<DashboardRealtimeDto> {
    return this.dashboardService.getRealtime();
  }
}
