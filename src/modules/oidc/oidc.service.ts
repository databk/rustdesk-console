import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { JwtService } from '@nestjs/jwt';
import { OidcProvider } from './entities/oidc-provider.entity';
import {
  OidcAuthState,
  OidcAuthStatus,
} from './entities/oidc-auth-state.entity';
import { User, UserInfo } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { OidcAuthRequestDto } from './dto/oidc.dto';

/**
 * OIDC配置接口
 * 定义OIDC提供商的配置信息
 */
export interface OidcConfig {
  /** 提供商名称 */
  name: string;
  /** 发行者URL */
  issuer: string;
  /** 客户端ID */
  client_id: string;
  /** 回调URI */
  redirect_uri?: string;
  /** 授权范围 */
  scope?: string;
}

/**
 * OIDC授权URL响应接口
 * 定义授权请求成功后返回的数据
 */
export interface OidcAuthUrlResponse {
  /** 授权码 */
  code: string;
  /** 授权URL */
  url: string;
}

/**
 * 认证响应体接口
 * 定义认证成功后返回的用户信息和令牌
 */
export interface AuthBody {
  /** 访问令牌 */
  access_token: string;
  /** 响应类型 */
  type: string;
  /** TFA类型 */
  tfa_type?: string;
  /** 密钥 */
  secret?: string;
  /** 用户信息 */
  user: {
    /** 用户名 */
    name: string;
    /** 邮箱 */
    email?: string;
    /** 备注 */
    note?: string;
    /** 状态 */
    status: number;
    /** 用户信息 */
    info?: UserInfo;
    /** 是否管理员 */
    is_admin: boolean;
    /** 第三方认证类型 */
    third_auth_type?: string;
  };
}

@Injectable()
/**
 * OidcService
 * 负责OpenID Connect第三方登录集成的核心服务
 *
 * 功能：
 * - OIDC提供商管理
 * - 授权流程管理
 * - 令牌交换
 * - 用户信息获取
 * - 认证状态管理
 *
 * 架构说明：
 * 实现OIDC授权码流程，支持多个OIDC提供商
 */
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  /** 授权码有效期（分钟） */
  private readonly AUTH_CODE_EXPIRY_MINUTES = 3;
  /** Token有效期（天） */
  private readonly TOKEN_EXPIRY_DAYS = 30;

  constructor(
    @InjectRepository(OidcProvider)
    private providerRepository: Repository<OidcProvider>,
    @InjectRepository(OidcAuthState)
    private authStateRepository: Repository<OidcAuthState>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserToken)
    private userTokenRepository: Repository<UserToken>,
    private jwtService: JwtService,
  ) {}

  /**
   * 获取所有启用的OIDC提供商
   * 返回可供用户选择的OIDC登录选项列表
   *
   * @returns OIDC配置选项列表，格式为 "common-oidc/{config_json}"
   */
  async getLoginOptions(): Promise<string[]> {
    const providers = await this.providerRepository.find({
      where: { enabled: true },
      order: { priority: 'ASC' },
    });

    const options: string[] = [];

    for (const provider of providers) {
      const config: OidcConfig = {
        name: provider.name,
        issuer: provider.issuer,
        client_id: provider.clientId,
        scope: provider.scope || 'openid email profile',
      };

      // 使用common-oidc格式返回配置
      options.push(`common-oidc/${JSON.stringify(config)}`);
    }

    return options;
  }

  /**
   * 请求OIDC授权
   * 发起OIDC认证流程，生成授权码和授权URL
   *
   * @param authRequest OIDC授权请求，包含提供商标识和设备信息
   * @returns 授权码和授权URL
   * @throws BadRequestException 当提供商不存在或未启用时抛出
   */
  async requestAuth(
    authRequest: OidcAuthRequestDto,
  ): Promise<OidcAuthUrlResponse> {
    const { op, id, uuid, deviceInfo } = authRequest;

    // 解析OIDC 提供商标识
    const providerName = op.replace('oidc/', '');

    const provider = await this.providerRepository.findOne({
      where: { name: providerName, enabled: true },
    });

    if (!provider) {
      throw new BadRequestException(
        `OIDC 提供商 "${providerName}" 不存在或未启用`,
      );
    }

    // 生成授权码
    const code = uuidv4();

    // 生成OIDC state参数（用于防止CSRF攻击）
    const state = uuidv4();

    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setMinutes(
      expiresAt.getMinutes() + this.AUTH_CODE_EXPIRY_MINUTES,
    );

    // 构建回调URL
    const redirectUri = `${process.env.OIDC_REDIRECT_URI || 'http://localhost:3000'}/api/oidc/callback`;

    // 保存授权状态
    const authState = this.authStateRepository.create({
      guid: uuidv4(),
      code,
      op,
      deviceId: id,
      deviceUuid: uuid,
      deviceInfo: JSON.stringify(deviceInfo),
      redirectUri,
      state,
      status: OidcAuthStatus.PENDING,
      expiresAt,
    });

    await this.authStateRepository.save(authState);

    // 构建授权URL
    const authEndpoint =
      provider.authorizationEndpoint || `${provider.issuer}/authorize`;
    const scope = provider.scope || 'openid email profile';

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state,
    });

    const url = `${authEndpoint}?${params.toString()}`;

    this.logger.log(`OIDC auth requested: code=${code}, op=${op}`);

    return { code, url };
  }

  /**
   * 查询OIDC授权状态
   * 查询OIDC授权是否成功，如果成功则返回访问令牌
   *
   * @param code 授权码
   * @param deviceId 设备ID
   * @param deviceUuid 设备UUID
   * @returns 认证响应，包含访问令牌和用户信息
   * @throws UnauthorizedException 当授权失败、过期或取消时抛出
   */
  async queryAuth(
    code: string,
    deviceId: string,
    deviceUuid: string,
  ): Promise<AuthBody> {
    // 查找授权状态
    const authState = await this.authStateRepository.findOne({
      where: {
        code,
        deviceId,
        deviceUuid,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!authState) {
      throw new UnauthorizedException('No authed oidc is found');
    }

    // 检查授权状态
    if (authState.status === OidcAuthStatus.PENDING) {
      throw new UnauthorizedException('No authed oidc is found');
    }

    if (authState.status === OidcAuthStatus.EXPIRED) {
      throw new UnauthorizedException('Authorization expired');
    }

    if (authState.status === OidcAuthStatus.CANCELLED) {
      throw new UnauthorizedException('Authorization cancelled');
    }

    // 授权成功，返回token
    if (
      authState.status === OidcAuthStatus.AUTHORIZED &&
      authState.accessToken
    ) {
      // 获取用户信息
      const user = await this.userRepository.findOne({
        where: { guid: authState.userGuid },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // 清理授权状态
      await this.authStateRepository.remove(authState);

      return {
        access_token: authState.accessToken,
        type: 'access_token',
        user: {
          name: user.username,
          email: user.email || undefined,
          note: user.note || undefined,
          status: user.status,
          info: user.getUserInfo(),
          is_admin: user.isAdmin,
          third_auth_type: user.thirdAuthType || undefined,
        },
      };
    }

    throw new UnauthorizedException('No authed oidc is found');
  }

  /**
   * 模拟OIDC code交换
   * 将授权码交换为用户信息和访问令牌
   *
   * @param provider OIDC提供商配置
   * @param code 授权码
   * @param redirectUri 回调URI
   * @returns 用户信息和访问令牌
   * @private
   * @deprecated 此方法为模拟实现，生产环境需要实现真实的OIDC流程
   */
  private exchangeCodeForUserInfo(
    _provider: OidcProvider,
    _code: string,
    _redirectUri: string,
  ): Promise<{ email: string; username?: string; access_token: string }> {
    // TODO: 实现实际的 OIDC 流程
    // 1. POST to token endpoint with code
    // 2. GET userinfo endpoint with access_token

    // 这里返回模拟数据用于测试
    // 实际项目中需要根据 provider 配置调用相应的 API
    this.logger.warn('OIDC code exchange not implemented, using mock data');

    return Promise.resolve({
      email: `oidc_user_${Date.now()}@example.com`,
      username: `oidc_user_${Date.now()}`,
      access_token: 'mock_oidc_access_token',
    });
  }

  /**
   * 为用户生成JWT token并保存到数据库
   * 创建JWT令牌并将其持久化，用于后续认证
   *
   * @param user 用户对象
   * @param deviceId 设备ID（可选）
   * @param deviceUuid 设备UUID（可选）
   * @returns 生成的JWT Token字符串
   * @private
   */
  private async generateTokenForUser(
    user: User,
    deviceId?: string,
    deviceUuid?: string,
  ): Promise<string> {
    // 生成JTI（JWT唯一标识符），用于令牌撤销验证
    // 与auth-token.service.ts保持一致的JTI机制
    const jti = uuidv4();
    // 构建JWT负载，包含用户信息和JTI标识符
    const payload = {
      sub: user.guid,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      deviceId,
      jti,
    };

    // 签发包含JTI的JWT Token
    const token = this.jwtService.sign(payload);

    // 计算Token过期时间（30天后）
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.TOKEN_EXPIRY_DAYS);

    // 在数据库中创建Token记录，存储JTI而非完整Token
    // guid使用jti值，与auth模块保持一致的数据结构
    const userToken = this.userTokenRepository.create({
      guid: jti,
      userGuid: user.guid,
      jti,
      deviceId,
      deviceUuid,
      expiresAt,
    });

    // 持久化Token记录，后续验证时通过JTI查询撤销状态
    await this.userTokenRepository.save(userToken);

    return token;
  }
}
