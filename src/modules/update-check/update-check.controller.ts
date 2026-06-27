import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Public } from '../../common/decorators/public.decorator';
import { UpdateCheckService } from './update-check.service';
import { ReportFrontendVersionDto } from './dto/update-check.dto';

/**
 * 更新检查控制器
 *
 * 端点：
 * - GET  /api/update-check                  - 检查更新（管理员）
 * - POST /api/update-check/frontend-version - 前端上报版本号（需共享密钥）
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
   * 前端上报版本号
   * 通过 SHARED_SECRET 环境变量验证前端容器身份
   * 未配置 SHARED_SECRET 时拒绝所有请求
   */
  @Post('frontend-version')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async reportFrontendVersion(@Body() dto: ReportFrontendVersionDto) {
    const sharedSecret = process.env.SHARED_SECRET;
    if (!sharedSecret) {
      throw new ForbiddenException('Shared secret is not configured');
    }
    if (dto.secret !== sharedSecret) {
      throw new ForbiddenException('Invalid shared secret');
    }

    await this.updateCheckService.reportFrontendVersion(dto.version);
    return { version: dto.version };
  }
}
