import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as client from 'openid-client';
import {
  OidcProvider,
  OidcProviderType,
} from '../entities/oidc-provider.entity';
import {
  OidcAuthState,
  OidcAuthStatus,
} from '../entities/oidc-auth-state.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { OidcAuthRequestDto } from '../dto/oidc.dto';
import { LoginResponse } from '../../../common/interfaces';
import { AuthTokenService } from '../../auth/services/auth-token.service';
import { AuthDeviceService } from '../../auth/services/auth-device.service';

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
 * OIDC用户信息接口
 * 从OIDC提供商获取的用户信息
 */
interface OidcUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  [key: string]: any;
}

/**
 * OIDC回调结果接口
 * 认证成功后返回的信息
 */
export interface OidcCallbackResult {
  /** 是否为Web前端登录 */
  isWebLogin: boolean;
  /** 前端重定向URL（仅Web前端登录时有值） */
  frontendRedirectUrl?: string;
  /** 访问令牌 */
  accessToken?: string;
  /** 用户信息 */
  user?: {
    username: string;
    email?: string;
    isAdmin: boolean;
  };
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
    private authTokenService: AuthTokenService,
    private deviceService: AuthDeviceService,
    private configService: ConfigService,
  ) {}

  /**
   * 验证前端回调URL是否在白名单中
   * 通过环境变量 WEB_FRONTEND_URLS 配置白名单（逗号分隔）
   *
   * @param callbackUrl 前端回调URL
   * @returns 是否在白名单中
   */
  private isCallbackUrlAllowed(callbackUrl: string): boolean {
    const allowedUrls = this.configService
      .get<string>('WEB_FRONTEND_URLS', '')
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    if (allowedUrls.length === 0) {
      this.logger.warn(
        'WEB_FRONTEND_URLS environment variable is not configured or empty',
      );
      return false;
    }

    try {
      const callbackUrlObj = new URL(callbackUrl);
      return allowedUrls.some((allowedUrl) => {
        try {
          const allowedUrlObj = new URL(allowedUrl);
          return (
            callbackUrlObj.origin === allowedUrlObj.origin &&
            callbackUrlObj.pathname.startsWith(allowedUrlObj.pathname)
          );
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  /**
   * 获取所有启用的OIDC提供商
   * 返回可供用户选择的OIDC登录选项列表
   *
   * @returns OIDC配置选项列表，格式为 "oidc/{provider_name}"
   */
  async getLoginOptions(): Promise<string[]> {
    const providers = await this.providerRepository.find({
      where: { enabled: true },
      order: { priority: 'ASC' },
    });

    const options: string[] = [];

    for (const provider of providers) {
      options.push(`oidc/${provider.name}`);
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
    const { op, id, uuid, deviceInfo, callbackUrl } = authRequest;

    const providerName = op.replace(/^(oidc|oauth2)\//, '');

    // 使用getProviderWithSecret获取包含clientSecret的完整配置
    // 确保缓存的OIDC配置包含clientSecret，避免handleCallback获取到不完整的缓存
    const provider = await this.getProviderWithSecret(providerName);

    if (!provider) {
      throw new BadRequestException(
        `OIDC 提供商 "${providerName}" 不存在或未启用`,
      );
    }

    // 验证并保存前端回调URL
    let frontendRedirectUrl: string | null = null;
    if (callbackUrl) {
      if (!this.isCallbackUrlAllowed(callbackUrl)) {
        throw new BadRequestException(
          'callbackUrl 不在允许的白名单中，请检查 WEB_FRONTEND_URLS 环境变量配置',
        );
      }
      frontendRedirectUrl = callbackUrl;
    }

    // 生成授权码（用于客户端轮询）
    const code = uuidv4();

    // 生成PKCE code verifier和challenge
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    // 生成OIDC state和nonce参数
    const state = client.randomState();
    const isOidc = provider.type === OidcProviderType.OIDC;
    const nonce = isOidc ? client.randomNonce() : undefined;

    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setMinutes(
      expiresAt.getMinutes() + this.AUTH_CODE_EXPIRY_MINUTES,
    );

    // 构建回调URL
    const redirectUri = `${this.configService.get<string>('OIDC_REDIRECT_URI', 'http://localhost:3000')}/api/oidc/callback`;

    // 保存授权状态
    const authState = this.authStateRepository.create({
      guid: uuidv4(),
      code,
      op,
      providerType: provider.type,
      deviceId: id ?? undefined,
      deviceUuid: uuid ?? undefined,
      deviceInfo: JSON.stringify(deviceInfo),
      redirectUri,
      state,
      nonce: nonce ?? undefined,
      codeVerifier,
      frontendRedirectUrl,
      status: OidcAuthStatus.PENDING,
      expiresAt,
    });

    await this.authStateRepository.save(authState);

    // 获取OIDC配置并构建授权URL
    const oidcConfig = await this.getOidcConfig(provider);
    const defaultScope =
      provider.type === OidcProviderType.OAUTH2
        ? 'read:user user:email'
        : 'openid email profile';
    const scope = provider.scope || defaultScope;

    const url = client.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      ...(nonce && { nonce }),
    });

    this.logger.log(`OIDC auth requested: code=${code}, op=${op}`);

    return { code, url: url.href };
  }

  /**
   * 处理OIDC回调
   * OIDC提供商授权后回调，交换授权码获取令牌和用户信息
   *
   * @param callbackUrl 回调完整URL（包含code和state参数）
   * @returns 认证结果，包含是否为Web登录、重定向URL、访问令牌和用户信息
   * @throws BadRequestException 当state无效或授权已过期时抛出
   * @throws UnauthorizedException 当令牌交换失败时抛出
   */
  async handleCallback(callbackUrl: string): Promise<OidcCallbackResult> {
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
      throw new BadRequestException('OIDC 认证失败，请重试');
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
    const providerName = authState.op.replace(/^(oidc|oauth2)\//, '');
    const provider = await this.getProviderWithSecret(providerName);

    if (!provider) {
      throw new BadRequestException(`OIDC 提供商 "${providerName}" 不存在`);
    }

    try {
      const oidcConfig = await this.getOidcConfig(provider);
      const isOidc = provider.type === OidcProviderType.OIDC;

      let userInfo: OidcUserInfo;

      if (isOidc) {
        userInfo = await this.handleOidcCallback(
          oidcConfig,
          callbackUrl,
          authState,
        );
      } else {
        userInfo = await this.handleOAuth2Callback(
          oidcConfig,
          callbackUrl,
          authState,
        );
      }

      // 查找或创建本地用户
      const user = await this.findOrCreateUser(userInfo, providerName);

      // 创建或更新设备记录（参考 auth.service.ts 实现）
      if (authState.deviceId || authState.deviceUuid) {
        await this.deviceService.createOrUpdateDevice(
          user.guid,
          authState.deviceId,
          authState.deviceUuid,
          authState.deviceInfo
            ? (JSON.parse(authState.deviceInfo) as Record<string, unknown>)
            : undefined,
        );
      }

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
      await this.authStateRepository.save(authState);

      this.logger.log(
        `OIDC auth successful: user=${user.username}, provider=${providerName}`,
      );

      // 判断是否为Web前端登录
      const isWebLogin = !!authState.frontendRedirectUrl;

      if (isWebLogin) {
        // Web前端登录：返回完整信息供controller设置Cookie
        return {
          isWebLogin: true,
          frontendRedirectUrl: authState.frontendRedirectUrl!,
          accessToken,
          user: {
            username: user.username,
            email: user.email || undefined,
            isAdmin: user.isAdmin,
          },
        };
      } else {
        // 客户端登录：返回简单信息
        return {
          isWebLogin: false,
        };
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`OIDC callback error: ${message}`, stack);
      // 不向客户端暴露内部错误详情
      throw new UnauthorizedException('OIDC 认证失败，请重试');
    }
  }

  private async handleOidcCallback(
    oidcConfig: client.Configuration,
    callbackUrl: string,
    authState: OidcAuthState,
  ): Promise<OidcUserInfo> {
    const tokens = await client.authorizationCodeGrant(
      oidcConfig,
      new URL(callbackUrl),
      {
        pkceCodeVerifier: authState.codeVerifier,
        expectedState: authState.state,
        expectedNonce: authState.nonce ?? undefined,
      },
    );

    const claims = tokens.claims();
    let userInfo: OidcUserInfo = {
      sub: claims?.sub ?? '',
      email: claims?.email as string | undefined,
      email_verified: claims?.email_verified as boolean | undefined,
      name: claims?.name as string | undefined,
      preferred_username: claims?.preferred_username as string | undefined,
    };

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
          email_verified: fetchedUserInfo.email_verified,
          name: fetchedUserInfo.name,
          preferred_username: fetchedUserInfo.preferred_username,
        };
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to fetch OIDC userinfo: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return userInfo;
  }

  private async handleOAuth2Callback(
    oidcConfig: client.Configuration,
    callbackUrl: string,
    authState: OidcAuthState,
  ): Promise<OidcUserInfo> {
    const tokens = await client.authorizationCodeGrant(
      oidcConfig,
      new URL(callbackUrl),
      {
        pkceCodeVerifier: authState.codeVerifier,
        expectedState: authState.state,
        idTokenExpected: false,
      },
    );

    const accessToken = tokens.access_token;

    if (!accessToken) {
      throw new UnauthorizedException(
        'OAuth2 令牌交换失败：未获取到 access_token',
      );
    }

    const providerName = authState.op.replace(/^(oidc|oauth2)\//, '');
    const provider = await this.getProviderWithSecret(providerName);

    if (!provider) {
      throw new BadRequestException(`OAuth2 提供商 "${providerName}" 不存在`);
    }

    return this.fetchOAuth2UserInfo(accessToken, provider);
  }

  private async fetchOAuth2UserInfo(
    accessToken: string,
    provider: OidcProvider,
  ): Promise<OidcUserInfo> {
    const userinfoEndpoint = provider.userinfoEndpoint;

    if (!userinfoEndpoint) {
      throw new BadRequestException(
        'OAuth2 提供商未配置用户信息端点，无法获取用户信息',
      );
    }

    try {
      const response = await fetch(userinfoEndpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'rustdesk-console',
        },
      });

      if (!response.ok) {
        throw new Error(
          `UserInfo request failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as Record<string, unknown>;

      return {
        sub: String(
          (data.id as string | number | undefined) ??
            (data.sub as string | undefined) ??
            (data.login as string | undefined) ??
            '',
        ),
        email: data.email as string | undefined,
        email_verified:
          (data.email_verified as boolean | undefined) ?? !!data.email,
        name:
          (data.name as string | undefined) ??
          (data.login as string | undefined),
        preferred_username:
          (data.login as string | undefined) ??
          (data.username as string | undefined) ??
          (data.name as string | undefined),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`OAuth2 userinfo fetch error: ${message}`);
      throw new UnauthorizedException('获取用户信息失败');
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
  ): Promise<LoginResponse> {
    // 原子操作：将AUTHORIZED状态标记为CONSUMED，防止并发重复获取Token
    const updateResult = await this.authStateRepository
      .createQueryBuilder()
      .update(OidcAuthState)
      .set({ status: OidcAuthStatus.CONSUMED })
      .where(
        'code = :code AND deviceId = :deviceId AND deviceUuid = :deviceUuid',
        {
          code,
          deviceId,
          deviceUuid,
        },
      )
      .andWhere('status = :status', { status: OidcAuthStatus.AUTHORIZED })
      .andWhere('expiresAt > :now', { now: new Date() })
      .execute();

    if (!updateResult.affected) {
      // 没有匹配到AUTHORIZED状态，检查其他状态以返回适当的错误信息
      const authState = await this.authStateRepository.findOne({
        where: { code, deviceId, deviceUuid },
      });

      if (!authState || authState.status === OidcAuthStatus.PENDING) {
        throw new UnauthorizedException({ error: 'No authed oidc is found' });
      }

      if (authState.status === OidcAuthStatus.EXPIRED) {
        throw new UnauthorizedException({ error: 'Authorization expired' });
      }

      if (authState.status === OidcAuthStatus.CANCELLED) {
        throw new UnauthorizedException({ error: 'Authorization cancelled' });
      }

      if (authState.status === OidcAuthStatus.CONSUMED) {
        throw new UnauthorizedException({
          error: 'Authorization already consumed',
        });
      }

      throw new UnauthorizedException({ error: 'No authed oidc is found' });
    }

    // 查询已标记为CONSUMED的记录
    const authState = await this.authStateRepository.findOne({
      where: { code, deviceId, deviceUuid, status: OidcAuthStatus.CONSUMED },
    });

    if (!authState || !authState.accessToken) {
      throw new UnauthorizedException({ error: 'No authed oidc is found' });
    }

    const user = await this.userRepository.findOne({
      where: { guid: authState.userGuid },
    });

    if (!user) {
      throw new UnauthorizedException({ error: 'User not found' });
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

  /**
   * 清除指定issuer的OIDC配置缓存
   * 当管理员修改提供商配置时调用
   */
  clearConfigCache(issuer?: string): void {
    if (issuer) {
      this.configCache.delete(issuer);
      this.configCacheTimestamp.delete(issuer);
    } else {
      this.configCache.clear();
      this.configCacheTimestamp.clear();
    }
  }

  /**
   * 获取OIDC客户端配置
   * 优先使用OIDC Discovery获取配置，失败时使用数据库中存储的端点
   *
   * @param provider OIDC提供商实体（需包含clientSecret）
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
      if (provider.type === OidcProviderType.OAUTH2) {
        throw new Error('OAuth2 provider, skipping OIDC discovery');
      }

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
        jwks_uri: provider.jwksUri,
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
   * 1. 仅通过OIDC sub + provider匹配已关联的OIDC用户
   * 2. 不通过邮箱自动关联已有账户（防止账户接管）
   * 3. 新用户设置thirdAuthType为'oidc'
   * 4. 用户名冲突时追加随机后缀，处理并发竞态
   *
   * @param oidcUserInfo OIDC用户信息
   * @param providerName 提供商名称
   * @returns 本地用户实体
   */
  private async findOrCreateUser(
    oidcUserInfo: OidcUserInfo,
    providerName: string,
  ): Promise<User> {
    // 通过OIDC sub查找已关联的用户（不通过邮箱关联，防止账户接管）
    const oidcSubject = `oidc:${providerName}:${oidcUserInfo.sub}`;
    const existingUser = await this.userRepository.findOne({
      where: { oidcSubject },
    });
    if (existingUser) {
      return existingUser;
    }

    // 生成用户名
    const username =
      oidcUserInfo.preferred_username ||
      oidcUserInfo.name ||
      oidcUserInfo.email?.split('@')[0] ||
      `oidc_${oidcUserInfo.sub.substring(0, 8)}`;

    // 确保用户名唯一，最多重试3次以处理并发竞态
    let finalUsername = username;
    let suffix = 1;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // 检查用户名是否已存在
      while (
        await this.userRepository.findOne({
          where: { username: finalUsername },
        })
      ) {
        finalUsername = `${username}_${suffix}`;
        suffix++;
      }

      try {
        // 创建新用户
        const userGuid = uuidv4();
        const user = new User();
        user.guid = userGuid;
        user.username = finalUsername;
        // 仅当邮箱已验证时才存储，避免未验证邮箱被用于身份关联
        user.email = (
          oidcUserInfo.email_verified ? oidcUserInfo.email : null
        ) as string;
        user.password = null as unknown as string;
        user.status = UserStatus.ACTIVE;
        user.isAdmin = false;
        user.note = `OIDC用户 (${providerName})`;
        user.thirdAuthType = 'oidc';
        user.oidcSubject = oidcSubject;

        await this.userRepository.save(user);
        this.logger.log(
          `OIDC user created: ${finalUsername} via ${providerName}`,
        );
        return user;
      } catch (err: unknown) {
        // 处理并发场景下的唯一约束冲突
        if (
          err instanceof QueryFailedError &&
          String(err.message).includes('UNIQUE')
        ) {
          this.logger.warn(
            `Username conflict on concurrent creation, retrying: ${finalUsername}`,
          );
          suffix++;
          finalUsername = `${username}_${suffix}`;
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Failed to create OIDC user after ${maxRetries} attempts due to username conflicts`,
    );
  }

  /**
   * 为用户生成JWT token
   * 委托给AuthTokenService处理，确保与密码登录的token生成逻辑一致
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
    return this.authTokenService.generateToken(user, deviceId, deviceUuid);
  }
}
