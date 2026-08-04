import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { JwtPayload } from '../../../common/services/token.service';
import { DeviceInfoDto } from '../dto/auth.dto';
import { TOKEN_EXPIRY_DAYS } from '../auth.constants';

export interface SessionInfo {
  jti: string;
  deviceId: string | null;
  deviceUuid: string | null;
  deviceOs: string | null;
  deviceType: string | null;
  deviceName: string | null;
  createdAt: Date;
  expiresAt: Date;
}

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
   * @param deviceInfo 设备信息（可选），包含操作系统、来源类型和设备名称
   * @returns 生成的JWT Token字符串
   */
  async generateToken(
    user: User,
    deviceId?: string,
    deviceUuid?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<string> {
    const jti = uuidv4();

    const payload: JwtPayload = {
      sub: user.guid,
      username: user.username,
      email: user.email ?? undefined,
      isAdmin: user.isAdmin,
      deviceId,
      jti,
    };

    const token = this.jwtService.sign(payload);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);

    const userToken = this.tokenRepository.create({
      guid: jti,
      userGuid: user.guid,
      jti,
      deviceId,
      deviceUuid,
      deviceOs: deviceInfo?.os,
      deviceType: deviceInfo?.type,
      deviceName: deviceInfo?.name,
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

  /**
   * 列出用户的有效登录会话
   * 返回未过期且未撤销的令牌及其设备信息
   *
   * @param userGuid 用户GUID
   * @returns 有效会话列表
   */
  async listSessions(userGuid: string): Promise<SessionInfo[]> {
    const tokens = await this.tokenRepository.find({
      where: {
        userGuid,
        isRevoked: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    return tokens.map((t) => ({
      jti: t.jti,
      deviceId: t.deviceId,
      deviceUuid: t.deviceUuid,
      deviceOs: t.deviceOs,
      deviceType: t.deviceType,
      deviceName: t.deviceName,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    }));
  }

  /**
   * 撤销指定会话
   * 通过 jti 撤销用户的一个登录会话
   *
   * @param userGuid 用户GUID
   * @param jti 令牌唯一标识符
   */
  async revokeSession(userGuid: string, jti: string): Promise<void> {
    const token = await this.tokenRepository.findOne({
      where: { userGuid, jti },
    });

    if (!token) {
      throw new NotFoundException('会话不存在');
    }

    token.isRevoked = true;
    await this.tokenRepository.save(token);
  }
}
