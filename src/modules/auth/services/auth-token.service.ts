import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';

/**
 * JWT负载接口
 * 定义JWT令牌中包含的用户信息
 */
export interface JwtPayload {
  /** 用户GUID */
  sub: string;
  /** 用户名 */
  username: string;
  /** 邮箱地址 */
  email?: string;
  /** 是否为管理员 */
  isAdmin: boolean;
  /** 设备ID */
  deviceId?: string;
  /** JWT唯一标识符，用于令牌撤销验证 */
  jti: string;
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
    // 生成JTI（JWT唯一标识符），用于令牌撤销验证
    // 每个Token都有唯一的JTI，通过在数据库中记录JTI状态来实现主动撤销功能
    // 即使JWT签名有效，只要数据库中对应的JTI被标记为已撤销，该Token即失效
    const jti = uuidv4();

    // 构建JWT负载，包含用户信息和JTI
    // JTI作为Payload的一部分被编码到Token中，用于后续验证时关联数据库记录
    const payload: JwtPayload = {
      sub: user.guid,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      deviceId,
      jti,
    };

    // 使用NestJS JWT服务签发Token，将包含JTI的Payload进行编码和签名
    const token = this.jwtService.sign(payload);

    // 计算Token过期时间（从当前时间起30天后）
    // 数据库中的过期时间用于清理过期Token，实际验证由JWT库处理
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.TOKEN_EXPIRY_DAYS);

    // 在数据库中创建Token记录，建立JTI与用户的映射关系
    // guid使用jti值，确保数据库主键与JWT中的JTI一致
    // isRevoked默认为false，表示Token处于有效状态
    const userToken = this.tokenRepository.create({
      guid: jti,
      userGuid: user.guid,
      jti,
      deviceId,
      deviceUuid,
      expiresAt,
    });

    // 持久化Token记录到数据库
    // 后续validateToken会查询此记录来验证Token是否已被撤销
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
      // 验证Token签名和有效期（JWT库自动检查exp等声明）
      const payload = this.jwtService.verify<JwtPayload>(token);

      // 通过JTI查询数据库记录，验证Token是否已被主动撤销
      // 即使JWT签名有效且未过期，如果数据库中isRevoked=true则拒绝
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
      // 先解析Token获取JTI，确保只撤销有效的Token
      const payload = this.jwtService.verify<JwtPayload>(token);
      // 通过JTI定位数据库记录，将isRevoked标记为true
      // 后续validateToken查询时会因isRevoked=true而拒绝该Token
      await this.tokenRepository.update(
        { userGuid, jti: payload.jti, isRevoked: false },
        { isRevoked: true },
      );
    } catch {
      throw new Error('Invalid token');
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
