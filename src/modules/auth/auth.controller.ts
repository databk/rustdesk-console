import { Controller, Post, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './services';
import { LoginDto, CurrentUserDto, LogoutDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { Request } from 'express';

/**
 * 认证控制器
 * 负责处理用户认证相关的HTTP请求，包括登录、登出和获取当前用户信息
 *
 * 端点数量：3个
 * - POST /api/login - 用户登录
 * - POST /api/logout - 用户登出
 * - POST /api/currentUser - 获取当前用户信息
 */
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 用户登录
   * 验证用户凭证并返回访问令牌
   *
   * 安全措施：
   * - 使用@Public装饰器，无需认证即可访问
   * - 启用限流保护：每分钟最多5次请求
   * - 返回HTTP 200状态码
   *
   * @param loginDto 登录数据传输对象，包含用户名和密码
   * @returns 登录成功返回访问令牌和用户信息
   * @throws UnauthorizedException 用户名或密码错误
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * 用户登出
   * 撤销用户的访问令牌，清除会话状态
   *
   * 功能说明：
   * - 从请求头提取Bearer令牌
   * - 将令牌添加到撤销列表
   * - 清除相关的会话数据
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param logoutDto 登出数据传输对象，包含设备信息
   * @param req Express请求对象，用于访问请求头
   * @returns 登出成功消息
   * @throws UnauthorizedException 令牌无效或已过期
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser('id') userId: string,
    @Body() logoutDto: LogoutDto,
    @Req() req: Request,
  ) {
    // 从请求头获取 token
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    await this.authService.logout(userId, logoutDto, token);
    return { message: '登出成功' };
  }

  /**
   * 获取当前用户信息
   * 根据JWT令牌获取当前登录用户的详细信息
   *
   * 功能说明：
   * - 验证JWT令牌的有效性
   * - 返回用户的完整信息
   * - 支持设备信息更新
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param currentUserDto 用户数据传输对象，包含设备信息
   * @returns 当前用户的详细信息
   * @throws UnauthorizedException 令牌无效或已过期
   */
  @Post('currentUser')
  @HttpCode(HttpStatus.OK)
  async getCurrentUser(
    @CurrentUser('id') userId: string,
    @Body() currentUserDto: CurrentUserDto,
  ) {
    return this.authService.getCurrentUser(userId, currentUserDto);
  }
}
