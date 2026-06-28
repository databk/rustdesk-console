import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UpdateCheckService } from './update-check.service';
import { CheckUpdateDto } from './dto/update-check.dto';

/**
 * 更新检查控制器
 *
 * 端点：
 * - POST /api/update-check - 检查更新（管理员），前端通过请求体携带版本号
 */
@Controller('update-check')
export class UpdateCheckController {
  constructor(private readonly updateCheckService: UpdateCheckService) {}

  /**
   * 检查更新
   * 收集系统信息并调用第三方 API，返回更新结果
   * 前端在请求体中携带自己的版本号，无需单独的上报接口
   */
  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async checkUpdate(@Body() dto: CheckUpdateDto) {
    return this.updateCheckService.checkUpdate(dto.frontend_version);
  }
}
