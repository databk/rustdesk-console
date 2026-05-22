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
import * as client from 'openid-client';
import { OidcProvider } from './entities/oidc-provider.entity';
import {
  OidcAuthState,
  OidcAuthStatus,
} from './entities/oidc-auth-state.entity';
import { User, UserStatus } from '../user/entities/user.entity';
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
    info?: Record<string, any>;
    /** 是否管理员 */
    is_admin: boolean;
    /** 第三方认证类型 */
    third_auth_type?: string;
  };
}

/**
 * OIDC用户信息接口
 * 从OIDC提供商获取的用户信息
 */
interface OidcUserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  [key: string]: any;
}

@Injectable()
/**
 * OidcService
 * 负责OpenID Connect第三方登录集成的核心服务
 *
 * 功能：
 * - OIDC提供商管理
 * - 授权码流程 + PKCE
 * - 令牌交换与ID Token验证
 * - 用户信息获取
 * - 用户自动创建/关联
 * - 认证状态管理
 *
 * 架构说明：
 * 实现OIDC Authorization Code Flow + PKCE，支持多个OIDC提供商
 * 使用openid-client库进行OIDC协议交互
 */
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  /** 授权码有效期（分钟） */
  private readonly AUTH_CODE_EXPIRY_MINUTES = 3;
  /** Token有效期（天） */
  private readonly TOKEN_EXPIRY_DAYS = 30;
  /** OIDC配置缓存 */
  private configCache = new Map<string, client.Configuration>();
  /** 配置缓存有效期（毫秒） */
  private readonly CONFIG_CACHE_TTL = 24 * 60 * 60 * 1000;
  /** 配置缓存时间戳 */
  private configCacheTimestamp = new Map<string, number>();

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

      options.push(`common-oidc/${JSON.stringify(config)}`);
    }

    return options;
  }

  /**
   * 请求OIDC授权
   * 发起OIDC认证流程，生成授权码和授权URL（含PKCE）
   *
   * @param authRequest OIDC授权请求，包含提供商标识和设备信息
   * @returns 授权码和授权URL
   * @throws BadRequestException 当提供商不存在或未启用时抛出
   */
  async requestAuth(
    authRequest: OidcAuthRequestDto,
  ): Promise<OidcAuthUrlResponse> {
    const { op, id, uuid, deviceInfo } = authRequest;

    const providerName = op.replace('oidc/', '');

    const provider = await this.providerRepository.findOne({
      where: { name: providerName, enabled: true },
    });

    if (!provider) {
      throw new BadRequestException(
        `OIDC 提供商 "${providerName}" 不存在或未启用`,
      );
    }

    // 生成授权码（用于客户端轮询）
    const code = uuidv4();

    // 生成PKCE code verifier和challenge
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    // 生成OIDC state和nonce参数
    const state = client.randomState();
    const nonce = client.randomNonce();

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
      nonce,
      codeVerifier,
      status: OidcAuthStatus.PENDING,
      expiresAt,
    });

    await this.authStateRepository.save(authState);

    // 获取OIDC配置并构建授权URL
    const oidcConfig = await this.getOidcConfig(provider);
    const scope = provider.scope || 'openid email profile';

    const url = client.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    this.logger.log(`OIDC auth requested: code=${code}, op=${op}`);

    return { code, url: url.href };
  }

  /**
   * 处理OIDC回调
   * OIDC提供商授权后回调，交换授权码获取令牌和用户信息
   *
   * @param callbackUrl 回调完整URL（包含code和state参数）
   * @throws BadRequestException 当state无效或授权已过期时抛出
   * @throws UnauthorizedException 当令牌交换失败时抛出
   */
  async handleCallback(callbackUrl: string): Promise<void> {
    // 从回调URL中提取state参数
    const urlObj = new URL(callbackUrl);
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');

    // 处理OIDC提供商返回的错误
    if (error) {
      const errorDescription =
        urlObj.searchParams.get('error_description') || error;
      this.logger.error(
        `OIDC provider returned error: ${error} - ${errorDescription}`,
      );
      throw new BadRequestException(`OIDC 认证失败: ${errorDescription}`);
    }

    if (!state) {
      throw new BadRequestException('OIDC 回调缺少 state 参数');
    }

    // 查找授权状态
    const authState = await this.authStateRepository.findOne({
      where: { state },
    });

    if (!authState) {
      throw new BadRequestException('无效的 OIDC state 参数');
    }

    // 检查授权状态是否已过期
    if (authState.expiresAt < new Date()) {
      authState.status = OidcAuthStatus.EXPIRED;
      await this.authStateRepository.save(authState);
      throw new BadRequestException('OIDC 授权已过期，请重新发起授权');
    }

    // 检查授权状态是否已被使用
    if (authState.status !== OidcAuthStatus.PENDING) {
      throw new BadRequestException('OIDC 授权状态异常');
    }

    // 获取OIDC提供商配置（包含clientSecret）
    const providerName = authState.op.replace('oidc/', '');
    const provider = await this.getProviderWithSecret(providerName);

    if (!provider) {
      throw new BadRequestException(`OIDC 提供商 "${providerName}" 不存在`);
    }

    try {
      // 获取OIDC配置
      const oidcConfig = await this.getOidcConfig(provider);

      // 使用openid-client交换授权码获取令牌
      // 该方法会自动验证ID Token的签名、nonce、audience等
      const tokens = await client.authorizationCodeGrant(
        oidcConfig,
        new URL(callbackUrl),
        {
          pkceCodeVerifier: authState.codeVerifier,
          expectedState: authState.state,
          expectedNonce: authState.nonce,
        },
      );

      // 从ID Token中获取用户声明
      const claims = tokens.claims();
      let userInfo: OidcUserInfo = {
        sub: claims?.sub ?? '',
        email: claims?.email as string | undefined,
        name: claims?.name as string | undefined,
        preferred_username: claims?.preferred_username as string | undefined,
      };

      // 如果ID Token中没有足够的用户信息，尝试从userinfo端点获取
      if (!userInfo.email && oidcConfig.serverMetadata().userinfo_endpoint) {
        try {
          const fetchedUserInfo = await client.fetchUserInfo(
            oidcConfig,
            tokens.access_token,
            claims?.sub ?? '',
          );
          userInfo = {
            ...userInfo,
            email: fetchedUserInfo.email,
            name: fetchedUserInfo.name,
            preferred_username: fetchedUserInfo.preferred_username,
          };
        } catch (err: unknown) {
          this.logger.warn(
            `Failed to fetch userinfo: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // 查找或创建本地用户
      const user = await this.findOrCreateUser(userInfo, providerName);

      // 生成JWT Token
      const accessToken = await this.generateTokenForUser(
        user,
        authState.deviceId,
        authState.deviceUuid,
      );

      // 更新授权状态为已授权
      authState.status = OidcAuthStatus.AUTHORIZED;
      authState.userGuid = user.guid;
      authState.accessToken = accessToken;
      authState.oidcAccessToken = tokens.access_token;
      authState.oidcRefreshToken = tokens.refresh_token as string;
      await this.authStateRepository.save(authState);

      this.logger.log(
        `OIDC auth successful: user=${user.username}, provider=${providerName}`,
      );
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`OIDC callback error: ${message}`, stack);
      throw new UnauthorizedException(`OIDC 认证失败: ${message}`);
    }
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

    if (authState.status === OidcAuthStatus.PENDING) {
      throw new UnauthorizedException('No authed oidc is found');
    }

    if (authState.status === OidcAuthStatus.EXPIRED) {
      throw new UnauthorizedException('Authorization expired');
    }

    if (authState.status === OidcAuthStatus.CANCELLED) {
      throw new UnauthorizedException('Authorization cancelled');
    }

    if (
      authState.status === OidcAuthStatus.AUTHORIZED &&
      authState.accessToken
    ) {
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
   * 获取OIDC客户端配置
   * 优先使用OIDC Discovery获取配置，失败时使用数据库中存储的端点
   *
   * @param provider OIDC提供商实体
   * @returns openid-client Configuration对象
   */
  private async getOidcConfig(
    provider: OidcProvider,
  ): Promise<client.Configuration> {
    const cacheKey = provider.issuer;

    // 检查缓存是否有效
    const cachedConfig = this.configCache.get(cacheKey);
    const cachedTimestamp = this.configCacheTimestamp.get(cacheKey);
    if (
      cachedConfig &&
      cachedTimestamp &&
      Date.now() - cachedTimestamp < this.CONFIG_CACHE_TTL
    ) {
      return cachedConfig;
    }

    try {
      // 尝试OIDC Discovery
      const config = await client.discovery(
        new URL(provider.issuer),
        provider.clientId,
        provider.clientSecret || undefined,
      );
      this.configCache.set(cacheKey, config);
      this.configCacheTimestamp.set(cacheKey, Date.now());
      this.logger.log(`OIDC discovery successful for ${provider.name}`);
      return config;
    } catch (err: unknown) {
      this.logger.warn(
        `OIDC discovery failed for ${provider.name}: ${err instanceof Error ? err.message : String(err)}, using manual configuration`,
      );

      // Discovery失败，使用数据库中存储的端点构建手动配置
      const metadata: client.ServerMetadata = {
        issuer: provider.issuer,
        authorization_endpoint: provider.authorizationEndpoint,
        token_endpoint: provider.tokenEndpoint,
        userinfo_endpoint: provider.userinfoEndpoint,
      };

      const config = new client.Configuration(
        metadata,
        provider.clientId,
        provider.clientSecret || undefined,
      );

      this.configCache.set(cacheKey, config);
      this.configCacheTimestamp.set(cacheKey, Date.now());
      return config;
    }
  }

  /**
   * 获取包含clientSecret的OIDC提供商信息
   * clientSecret列默认不查询（select: false），需要显式添加
   *
   * @param name 提供商名称
   * @returns 包含clientSecret的提供商实体
   */
  private async getProviderWithSecret(
    name: string,
  ): Promise<OidcProvider | null> {
    return this.providerRepository
      .createQueryBuilder('provider')
      .where('provider.name = :name AND provider.enabled = :enabled', {
        name,
        enabled: true,
      })
      .addSelect('provider.clientSecret')
      .getOne();
  }

  /**
   * 查找或创建本地用户
   * 根据OIDC用户信息匹配现有用户，不存在则自动创建
   *
   * 策略：
   * 1. 优先通过邮箱匹配现有用户
   * 2. 邮箱无匹配时创建新用户
   * 3. 新用户设置thirdAuthType为'oidc'
   * 4. 用户名冲突时追加随机后缀
   *
   * @param oidcUserInfo OIDC用户信息
   * @param providerName 提供商名称
   * @returns 本地用户实体
   */
  private async findOrCreateUser(
    oidcUserInfo: OidcUserInfo,
    providerName: string,
  ): Promise<User> {
    // 优先通过邮箱查找现有用户
    if (oidcUserInfo.email) {
      const existingUser = await this.userRepository.findOne({
        where: { email: oidcUserInfo.email },
      });
      if (existingUser) {
        // 更新第三方认证类型
        if (!existingUser.thirdAuthType) {
          existingUser.thirdAuthType = 'oidc';
          await this.userRepository.save(existingUser);
        }
        return existingUser;
      }
    }

    // 生成用户名
    const username =
      oidcUserInfo.preferred_username ||
      oidcUserInfo.name ||
      oidcUserInfo.email?.split('@')[0] ||
      `oidc_${oidcUserInfo.sub.substring(0, 8)}`;

    // 确保用户名唯一
    let finalUsername = username;
    let suffix = 1;
    while (
      await this.userRepository.findOne({ where: { username: finalUsername } })
    ) {
      finalUsername = `${username}_${suffix}`;
      suffix++;
    }

    // 创建新用户
    const userGuid = uuidv4();
    const user = new User();
    user.guid = userGuid;
    user.username = finalUsername;
    user.email = (oidcUserInfo.email || null) as string;
    user.password = null as unknown as string;
    user.status = UserStatus.ACTIVE;
    user.isAdmin = false;
    user.note = `OIDC用户 (${providerName})`;
    user.thirdAuthType = 'oidc';

    await this.userRepository.save(user);
    this.logger.log(`OIDC user created: ${finalUsername} via ${providerName}`);

    return user;
  }

  /**
   * 为用户生成JWT token并保存到数据库
   *
   * @param user 用户对象
   * @param deviceId 设备ID（可选）
   * @param deviceUuid 设备UUID（可选）
   * @returns 生成的JWT Token字符串
   */
  private async generateTokenForUser(
    user: User,
    deviceId?: string,
    deviceUuid?: string,
  ): Promise<string> {
    const jti = uuidv4();
    const payload = {
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

    const userToken = this.userTokenRepository.create({
      guid: jti,
      userGuid: user.guid,
      jti,
      deviceId,
      deviceUuid,
      expiresAt,
    });

    await this.userTokenRepository.save(userToken);

    return token;
  }
}
