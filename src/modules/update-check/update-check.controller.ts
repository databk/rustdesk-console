import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Public } from '../../common/decorators/public.decorator';
import { UpdateCheckService } from './update-check.service';
import { ReportFrontendVersionDto } from './dto/update-check.dto';

/**
 * 更新检查控制器
 *
 * 端点：
 * - GET  /api/update-check                  - 检查更新（管理员）
 * - POST /api/update-check/frontend-version - 前端上报版本号（TOFU + 私有网络校验）
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
   *
   * 安全机制（TOFU - Trust On First Use）：
   * 1. 请求必须来自私有网络（Docker 内网 / 局域网）
   * 2. 首次上报时自动记录来源 IP 为信任地址
   * 3. 之后只允许来自该信任 IP 的上报
   * 4. 容器重建导致 IP 变更时，需管理员通过设置接口重置信任 IP
   */
  @Post('frontend-version')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async reportFrontendVersion(
    @Body() dto: ReportFrontendVersionDto,
    @Req() req: Request,
  ) {
    const clientIp = this.getClientIp(req);

    if (!this.isPrivateIp(clientIp)) {
      throw new ForbiddenException('Access denied: not from private network');
    }

    const trustedIp = await this.updateCheckService.getTrustedFrontendIp();

    if (trustedIp) {
      if (clientIp !== trustedIp) {
        throw new ForbiddenException(
          'Access denied: IP not in trust list. Reset via admin settings if frontend container was recreated.',
        );
      }
    } else {
      // First use: trust this IP
      await this.updateCheckService.setTrustedFrontendIp(clientIp);
    }

    await this.updateCheckService.reportFrontendVersion(dto.version);
    return { version: dto.version };
  }

  /**
   * 获取客户端真实 IP
   * Docker 内网直接访问时无代理头，使用 req.ip 即可
   */
  private getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  /**
   * 检查是否为私有网络 IP
   * 覆盖 IPv4 私有地址范围和 Docker 默认网段
   */
  private isPrivateIp(ip: string): boolean {
    // 处理 IPv6 映射的 IPv4 地址 (::ffff:192.168.1.1)
    const normalizedIp = ip.replace(/^::ffff:/, '');

    // IPv4 私有地址范围
    const privateRanges = [
      /^10\./,                           // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./,                     // 192.168.0.0/16
      /^127\./,                          // 127.0.0.0/8 (loopback)
      /^169\.254\./,                     // 169.254.0.0/16 (link-local)
    ];

    return privateRanges.some((range) => range.test(normalizedIp));
  }
}
