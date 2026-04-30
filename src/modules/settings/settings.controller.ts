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
import { SmtpSettingsService } from './services/smtp-settings.service';
import {
  UpdateSmtpConfigDto,
  TestSmtpConfigDto,
} from './dto/smtp-config.dto';

/**
 * 系统设置控制器
 * 管理系统配置相关的 API 接口
 *
 * 端点数量：3个
 * - GET  /api/settings/smtp      - 获取 SMTP 配置
 * - PUT  /api/settings/smtp      - 创建或更新 SMTP 配置（Upsert）
 * - POST /api/settings/smtp/test - 测试 SMTP 连接
 *
 * 所有端点需要管理员权限
 */
@UseGuards(AdminGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly smtpSettingsService: SmtpSettingsService) {}

  /**
   * 获取 SMTP 配置
   * 返回当前生效的 SMTP 配置，密码字段脱敏
   * 如果配置不存在，返回 404
   */
  @Get('smtp')
  async getSmtpConfig() {
    return this.smtpSettingsService.getSmtpConfig();
  }

  /**
   * 创建或更新 SMTP 配置（Upsert语义）
   * 配置不存在时创建，存在时更新
   * 仅更新传入的字段，密码字段传入占位符时不更新
   */
  @Put('smtp')
  @HttpCode(HttpStatus.OK)
  async updateSmtpConfig(@Body() dto: UpdateSmtpConfigDto) {
    return this.smtpSettingsService.updateSmtpConfig(dto);
  }

  /**
   * 测试 SMTP 连接
   * 可传入配置进行测试，不传则测试当前生效配置
   *
   * 限流：每分钟最多5次，防止滥用
   */
  @Post('smtp/test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async testSmtpConnection(@Body() dto?: TestSmtpConfigDto) {
    return this.smtpSettingsService.testSmtpConnection(dto);
  }
}
