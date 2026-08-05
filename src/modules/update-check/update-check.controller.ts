import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UpdateCheckService } from './update-check.service';

/**
 * 更新检查控制器
 *
 * 端点：
 * - GET /api/update-check - 获取缓存的更新检查结果（管理员）
 */
@Controller('update-check')
export class UpdateCheckController {
  constructor(private readonly updateCheckService: UpdateCheckService) {}

  /**
   * 获取缓存的更新检查结果
   * 后端每1小时自动检查更新，前端请求时直接返回缓存
   */
  @Get()
  @UseGuards(AdminGuard)
  async checkUpdate(@Query('frontend_version') frontendVersion?: string) {
    return this.updateCheckService.checkUpdate(frontendVersion);
  }
}
