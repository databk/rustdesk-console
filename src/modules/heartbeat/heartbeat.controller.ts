import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Public } from '../auth/decorators/public.decorator';
import { DeviceThrottlerGuard } from '../../common/guards/device-throttler.guard';

/**
 * 心跳控制器
 * 负责处理设备心跳请求，维护设备在线状态
 *
 * 端点数量：1个
 * - POST /api/heartbeat - 接收设备心跳
 */
@Controller('heartbeat')
@UseGuards(DeviceThrottlerGuard)
export class HeartbeatController {
  private readonly logger = new Logger(HeartbeatController.name);

  constructor(private readonly HeartbeatService: HeartbeatService) {}

  /**
   * 接收设备心跳
   * 处理设备发送的心跳数据，更新设备在线状态和最后活跃时间
   *
   * 功能说明：
   * - 验证设备身份和令牌有效性
   * - 更新设备的在线状态
   * - 记录设备的最后活跃时间
   * - 更新设备信息（如IP地址、操作系统等）
   *
   * 安全措施：
   * - 使用@Public装饰器，无需认证即可访问（设备使用自己的令牌）
   * - 启用限流保护：每分钟最多10次请求
   *
   * @param HeartbeatDto 心跳数据传输对象，包含设备ID、令牌和状态信息
   * @returns 处理成功返回确认消息
   * @throws UnauthorizedException 设备令牌无效或已过期
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post()
  receiveHeartbeat(@Body() HeartbeatDto: HeartbeatDto) {
    this.logger.log(
      `[receiveHeartbeat] 收到心跳请求: id=${HeartbeatDto.id}, uuid=${HeartbeatDto.uuid}, ver=${HeartbeatDto.ver}, modified_at=${HeartbeatDto.modified_at}, conns=${JSON.stringify(HeartbeatDto.conns ?? [])}`,
    );

    const startTime = Date.now();

    try {
      const result = this.HeartbeatService.handleHeartbeat(HeartbeatDto);

      result.then((res) => {
        const elapsed = Date.now() - startTime;
        this.logger.log(
          `[receiveHeartbeat] 心跳处理完成: uuid=${HeartbeatDto.uuid}, elapsed=${elapsed}ms, code=${res.code}`,
        );
      }).catch((err: unknown) => {
        const elapsed = Date.now() - startTime;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[receiveHeartbeat] 心跳处理失败: uuid=${HeartbeatDto.uuid}, elapsed=${elapsed}ms, error=${msg}`,
        );
      });

      return result;
    } catch (error: unknown) {
      const elapsed = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[receiveHeartbeat] 心跳处理同步异常: uuid=${HeartbeatDto.uuid}, elapsed=${elapsed}ms, error=${msg}`,
      );
      throw error;
    }
  }
}
