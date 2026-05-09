import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { JwtPayload } from '../../../common/services/token.service';

@Injectable()
/**
 * AuthTokenService
 * 负责JWT令牌生成和验证的子服务
 *
 * 与主服务关系：
 * 被AuthService委托处理令牌相关操作
 *
 * 调用上下文：
 * 包括令牌生成、验证和撤销
 */
export class AuthTokenService {
  /** Token有效期（天） */
  private readonly TOKEN_EXPIRY_DAYS = 30;

  constructor(
    @InjectRepository(UserToken)
    private tokenRepository: Repository<UserToken>,
    private jwtService: JwtService,
  ) {}

  /**
   * 生成JWT Token
   * 创建JWT令牌并将其保存到数据库，用于后续验证和撤销
   *
   * @param user 用户对象
   * @param deviceId 设备ID（可选）
   * @param deviceUuid 设备UUID（可选）
   * @returns 生成的JWT Token字符串
   */
  async generateToken(
    user: User,
    deviceId?: string,
    deviceUuid?: string,
  ): Promise<string> {
    const jti = uuidv4();

    const payload: JwtPayload = {
      sub: user.guid,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      deviceId,
      jti,
    };

    const token = this.jwtService.sign(payload);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.TOKEN_EXPIRY_DAYS);

    const userToken = this.tokenRepository.create({
      guid: jti,
      userGuid: user.guid,
      jti,
      deviceId,
      deviceUuid,
      expiresAt,
    });

    await this.tokenRepository.save(userToken);

    return token;
  }

  /**
   * 验证JWT Token
   * 验证Token的签名和有效期，并检查是否已被撤销
   *
   * @param token JWT令牌字符串
   * @returns Token负载，验证失败或Token已撤销返回null
   */
  async validateToken(token: string): Promise<JwtPayload | null> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      const tokenRecord = await this.tokenRepository.findOne({
        where: { jti: payload.jti, isRevoked: false },
      });

      if (!tokenRecord) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * 撤销指定的Token
   * 将Token标记为已撤销，使其无法再用于认证
   *
   * @param userGuid 用户GUID
   * @param token 要撤销的Token字符串
   */
  async revokeToken(userGuid: string, token: string): Promise<void> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      await this.tokenRepository.update(
        { userGuid, jti: payload.jti, isRevoked: false },
        { isRevoked: true },
      );
    } catch {
      // Token无效或已过期，静默失败
    }
  }

  /**
   * 撤销用户设备的所有Token
   * 撤销指定设备的所有Token，通常在用户登出或设备移除时调用
   *
   * @param userGuid 用户GUID
   * @param deviceId 设备ID（可选）
   * @param deviceUuid 设备UUID（可选）
   */
  async revokeDeviceTokens(
    userGuid: string,
    deviceId?: string,
    deviceUuid?: string,
  ): Promise<void> {
    if (!deviceId && !deviceUuid) return;

    await this.tokenRepository.update(
      {
        userGuid,
        deviceId,
        deviceUuid,
        isRevoked: false,
      },
      { isRevoked: true },
    );
  }
}
