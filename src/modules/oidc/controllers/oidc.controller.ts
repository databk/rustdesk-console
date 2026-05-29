import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { OidcService } from '../services/oidc.service';
import { OidcAuthRequestDto } from '../dto/oidc.dto';
import { Public } from '../../auth/decorators/public.decorator';

/**
 * HTML特殊字符转义，防止XSS攻击
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * OIDC控制器
 * 处理OpenID Connect第三方登录相关的HTTP请求
 *
 * 端点：
 * - GET /api/login-options - 获取登录选项
 * - POST /api/oidc/auth - 请求OIDC授权
 * - GET /api/oidc/auth-query - 查询OIDC授权状态
 * - GET /api/oidc/callback - OIDC提供商回调
 */
@Controller()
export class OidcController {
  private readonly logger = new Logger(OidcController.name);
  private readonly successHtml: string;
  private readonly errorHtml: string;

  constructor(
    private readonly oidcService: OidcService,
    private readonly configService: ConfigService,
  ) {
    this.successHtml = fs.readFileSync(
      path.join(__dirname, 'templates', 'callback-success.html'),
      'utf-8',
    );
    this.errorHtml = fs.readFileSync(
      path.join(__dirname, 'templates', 'callback-error.html'),
      'utf-8',
    );
  }

  /**
   * 获取登录选项
   * 返回当前可用的OIDC第三方登录选项列表
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('login-options')
  async getLoginOptions() {
    return this.oidcService.getLoginOptions();
  }

  /**
   * 请求OIDC授权
   * 发起OIDC第三方登录授权请求，返回授权URL
   *
   * @param authRequest OIDC授权请求数据传输对象
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('oidc/auth')
  async requestAuth(@Body() authRequest: OidcAuthRequestDto) {
    return this.oidcService.requestAuth(authRequest);
  }

  /**
   * 查询OIDC授权状态
   * 客户端轮询此接口获取授权结果
   *
   * @param code 授权码
   * @param deviceId 设备ID
   * @param deviceUuid 设备UUID
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('oidc/auth-query')
  async queryAuth(
    @Query('code') code: string,
    @Query('id') deviceId: string,
    @Query('uuid') deviceUuid: string,
  ) {
    return this.oidcService.queryAuth(code, deviceId, deviceUuid);
  }

  /**
   * OIDC提供商回调端点
   * OIDC提供商授权完成后重定向到此端点
   * 交换授权码获取令牌，更新授权状态，返回成功页面
   *
   * @param req Express请求对象
   * @param res Express响应对象
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('oidc/callback')
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    try {
      // 使用配置的OIDC_REDIRECT_URI构建回调URL，避免依赖可被伪造的Host头
      const baseUrl = this.configService.get<string>(
        'OIDC_REDIRECT_URI',
        'http://localhost:3000',
      );
      const callbackUrl = `${baseUrl}${req.originalUrl}`;

      await this.oidcService.handleCallback(callbackUrl);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(this.successHtml);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : '第三方认证过程中发生错误，请重试。';
      this.logger.error(`OIDC callback error: ${message}`);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res
        .status(400)
        .send(this.errorHtml.replace('{{message}}', escapeHtml(message)));
    }
  }
}
