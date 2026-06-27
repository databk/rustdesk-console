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
import { Public } from '../../common/decorators/public.decorator';
import { UpdateCheckService } from './update-check.service';
import {
  ReportFrontendVersionDto,
  SetUpdateChannelDto,
  UpdateChannel,
} from './dto/update-check.dto';

/**
 * 更新检查控制器
 *
 * 端点：
 * - GET  /api/update-check           - 检查更新（管理员）
 * - GET  /api/update-check/channel   - 获取当前更新通道（管理员）
 * - PUT  /api/update-check/channel   - 设置更新通道（管理员）
 * - POST /api/update-check/frontend-version - 前端上报版本号（公开，前端容器调用）
 */
@Controller('update-check')
export class UpdateCheckController {
  constructor(private readonly updateCheckService: UpdateCheckService) {}

  /**
   * 检查更新
   * 收集系统信息并调用第三方 API，返回更新结果
   */
  @Get()
  @UseGuards(AdminGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async checkUpdate() {
    return this.updateCheckService.checkUpdate();
  }

  /**
   * 获取当前更新通道
   */
  @Get('channel')
  @UseGuards(AdminGuard)
  async getUpdateChannel() {
    const channel = await this.updateCheckService.getUpdateChannel();
    return { channel };
  }

  /**
   * 设置更新通道
   */
  @Put('channel')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async setUpdateChannel(@Body() dto: SetUpdateChannelDto) {
    await this.updateCheckService.setUpdateChannel(dto.channel);
    return { channel: dto.channel };
  }

  /**
   * 前端上报版本号
   * 公开接口，前端容器启动时调用，无需认证
   */
  @Post('frontend-version')
  @Public()
  @HttpCode(HttpStatus.OK)
  async reportFrontendVersion(@Body() dto: ReportFrontendVersionDto) {
    await this.updateCheckService.reportFrontendVersion(dto.version);
    return { version: dto.version };
  }
}
