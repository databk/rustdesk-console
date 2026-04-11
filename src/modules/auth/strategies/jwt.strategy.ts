import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { JwtPayload } from '../../../common/services/token.service';

/**
 * JWT认证策略
 * 使用Passport的JWT策略进行令牌验证和用户认证
 *
 * 验证逻辑：
 * 1. 从请求头的Authorization字段提取Bearer令牌
 * 2. 使用JWT密钥验证令牌签名和有效期
 * 3. 检查令牌是否已被撤销
 * 4. 提取用户信息并返回
 *
 * 安全措施：
 * - 不忽略令牌过期时间
 * - 支持令牌撤销机制
 * - 使用环境变量配置JWT密钥
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private authService: AuthService) {
    const jwtSecret = process.env.JWT_SECRET || 'rustdesk-api-secret-key-change-in-production';

    // 检查是否使用默认 JWT 密钥
    if (!process.env.JWT_SECRET) {
      const logger = new Logger('JwtStrategy');
      logger.warn('WARNING: Using default JWT secret key. Please set JWT_SECRET environment variable in production!');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      passReqToCallback: true,
    });
  }

  /**
   * 验证JWT令牌
   * 验证令牌的有效性并提取用户信息
   *
   * 验证流程：
   * 1. 从请求头提取Bearer令牌
   * 2. 检查令牌是否存在
   * 3. 验证令牌是否被撤销
   * 4. 提取用户信息（ID、用户名、邮箱、管理员标志）
   *
   * @param req Express请求对象，用于访问请求头
   * @param payload JWT载荷，包含用户基本信息
   * @returns 验证通过的用户信息
   * @throws UnauthorizedException 令牌无效、已过期或已被撤销
   */
  async validate(req: Request, payload: JwtPayload): Promise<any> {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);

    // Token 不存在时直接拒绝
    if (!token) {
      throw new UnauthorizedException('Token 无效');
    }

    // 验证 Token 是否被撤销
    const validPayload = await this.authService.validateToken(token);
    if (!validPayload) {
      throw new UnauthorizedException('Token 已失效或被撤销');
    }

    const { sub, username, email, isAdmin } = payload;

    // 保持原有字段名 id，实际值是用户的 guid
    return {
      id: sub,  // 保持原有字段名 id，值为用户的 guid
      username,
      email,
      isAdmin,
    };
  }
}
