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
import type { Request, Response } from 'express';
import { OidcService } from './oidc.service';
import { OidcAuthRequestDto } from './dto/oidc.dto';
import { Public } from '../auth/decorators/public.decorator';

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

  constructor(private readonly oidcService: OidcService) {}

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
  @Throttle({ default: { limit: 20, ttl: 60000 } })
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
  @Throttle({ default: { limit: 20, ttl: 60000 } })
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
      // 构建完整的回调URL（包含查询参数）
      const protocol = req.protocol;
      const host = req.get('host');
      const originalUrl = req.originalUrl;
      const callbackUrl = `${protocol}://${host}${originalUrl}`;

      await this.oidcService.handleCallback(callbackUrl);

      // 返回成功页面
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>认证成功</title>
  <style>
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
      max-width: 400px;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      color: #333;
      margin: 0 0 12px;
      font-size: 24px;
    }
    p {
      color: #666;
      margin: 0;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10003;</div>
    <h1>认证成功</h1>
    <p>您已成功登录，可以关闭此窗口返回应用。</p>
  </div>
</body>
</html>
      `);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : '第三方认证过程中发生错误，请重试。';
      this.logger.error(`OIDC callback error: ${message}`);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>认证失败</title>
  <style>
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
      max-width: 400px;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
      color: #e74c3c;
    }
    h1 {
      color: #333;
      margin: 0 0 12px;
      font-size: 24px;
    }
    p {
      color: #666;
      margin: 0;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10007;</div>
    <h1>认证失败</h1>
    <p>${message}</p>
  </div>
</body>
</html>
      `);
    }
  }
}
