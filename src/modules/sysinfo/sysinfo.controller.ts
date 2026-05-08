import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SysinfoService } from './sysinfo.service';
import { SysinfoDto } from './dto/sysinfo.dto';
import { Public } from '../auth/decorators/public.decorator';
import { DeviceThrottlerGuard } from '../../common/guards/device-throttler.guard';

/**
 * 系统信息控制器
 * 负责处理设备系统信息的上报和查询
 *
 * 端点数量：1个
 * - POST /api/sysinfo - 提交系统信息
 */
@Controller()
@UseGuards(DeviceThrottlerGuard)
export class SysinfoController {
  constructor(private readonly sysinfoService: SysinfoService) {}

  /**
   * 提交系统信息
   * 接收设备上报的系统信息并保存到数据库
   *
   * 功能说明：
   * - 验证设备身份和令牌有效性
   * - 保存设备的系统信息（操作系统、硬件配置等）
   * - 支持预设地址簿和设备组的自动分配
   * - 记录系统信息的提交时间
   *
   * 安全措施：
   * - 使用@Public装饰器，无需认证即可访问（设备使用自己的令牌）
   * - 启用限流保护：每分钟最多5次请求
   *
   * @param sysinfoDto 系统信息数据传输对象，包含设备ID、令牌和系统详细信息
   * @returns 提交成功返回消息、成功标志、UUID和提交时间
   * @throws UnauthorizedException 设备令牌无效或已过期
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('sysinfo')
  async submitSysInfo(@Body() sysinfoDto: SysinfoDto) {
    const result = await this.sysinfoService.createSysinfo(sysinfoDto);
    return {
      message: '提交系统信息成功',
      success: true,
      data: { uuid: result.uuid, submitTime: result.createdAt },
    };
  }
}
