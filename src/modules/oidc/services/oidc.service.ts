import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
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
import { UserGroupService } from '../../user-group/user-group.service';
import { GeneralSettingsService } from '../../settings/services/general-settings.service';

/**
 * OIDC configuration interface
 * Defines the configuration of an OIDC provider
 */
export interface OidcConfig {
  /** Provider name */
  name: string;
  /** Issuer URL */
  issuer: string;
  /** Client ID */
  client_id: string;
  /** Callback URI */
  redirect_uri?: string;
  /** Authorization scope */
  scope?: string;
}

/**
 * OIDC authorization URL response interface
 * Defines the data returned after a successful authorization request
 */
export interface OidcAuthUrlResponse {
  /** Authorization code */
  code: string;
  /** Authorization URL */
  url: string;
}

/**
 * OIDC user info interface
 * User info obtained from the OIDC provider
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
 * OIDC callback result interface
 * Information returned after successful authentication
 */
export interface OidcCallbackResult {
  /** Whether this is a Web frontend login */
  isWebLogin: boolean;
  /** Frontend redirect URL (set only for Web frontend login) */
  frontendRedirectUrl?: string;
  /** Access token */
  accessToken?: string;
  /** User info */
  user?: {
    username: string;
    email?: string;
    isAdmin: boolean;
  };
}

@Injectable()
/**
 * OidcService
 * Core service for OpenID Connect third-party login integration
 *
 * Features:
 * - OIDC provider management
 * - Authorization code flow + PKCE
 * - Token exchange and ID Token validation
 * - User info retrieval
 * - Automatic user creation/linking
 * - Authentication state management
 *
 * Architecture notes:
 * Implements OIDC Authorization Code Flow + PKCE and supports multiple OIDC providers
 * Uses the openid-client library for OIDC protocol interaction
 */
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  /** Authorization code validity period (minutes) */
  private readonly AUTH_CODE_EXPIRY_MINUTES = 3;
  /** OIDC configuration cache */
  private configCache = new Map<string, client.Configuration>();
  /** Configuration cache validity period (milliseconds) */
  private readonly CONFIG_CACHE_TTL = 24 * 60 * 60 * 1000;
  /** Configuration cache timestamp */
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
    private readonly generalSettingsService: GeneralSettingsService,
    private readonly userGroupService: UserGroupService,
  ) {}

  /**
   * Verifies that the frontend callback URL is within the allowed site addresses
   * Allowed frontend addresses are configured via site.frontendUrl in general settings
   *
   * @param callbackUrl frontend callback URL
   * @returns whether it is allowed
   */
  private async isCallbackUrlAllowed(callbackUrl: string): Promise<boolean> {
    const { frontendUrl } = await this.generalSettingsService.getSiteSettings();

    if (!frontendUrl) {
      this.logger.warn(
        'site.frontendUrl is not configured, OIDC callback URL validation rejected all callbacks',
      );
      return false;
    }

    try {
      const callbackUrlObj = new URL(callbackUrl);
      const allowedUrlObj = new URL(frontendUrl);
      return (
        callbackUrlObj.origin === allowedUrlObj.origin &&
        callbackUrlObj.pathname.startsWith(allowedUrlObj.pathname)
      );
    } catch {
      return false;
    }
  }

  /**
   * Get all enabled OIDC providers
   * Returns the list of OIDC login options users can choose from
   *
   * When all providers are built-in (no custom icon), the simple oidc/{name} format is used
   * When custom providers (with an icon) exist, the common-oidc/{json} format is used to include icon information
   * The client looks for the common-oidc/ prefix first and falls back to the oidc/ prefix if not found
   *
   * @returns list of OIDC configuration options
   */
  async getLoginOptions(): Promise<string[]> {
    const providers = await this.providerRepository.find({
      where: { enabled: true },
      order: { priority: 'ASC' },
    });

    const hasCustomIcon = providers.some((p) => p.icon);

    if (!hasCustomIcon) {
      return providers.map((provider) => `oidc/${provider.name}`);
    }

    const options = providers.map((provider) => ({
      name: provider.name,
      icon: provider.icon || null,
    }));

    return [`common-oidc/${JSON.stringify(options)}`];
  }

  /**
   * Request OIDC authorization
   * Starts the OIDC authentication flow and generates the authorization code and authorization URL (with PKCE)
   *
   * @param authRequest OIDC authorization request, containing the provider identifier and device info
   * @returns authorization code and authorization URL
   * @throws BadRequestException thrown when the provider does not exist or is not enabled
   */
  async requestAuth(
    authRequest: OidcAuthRequestDto,
  ): Promise<OidcAuthUrlResponse> {
    const { op, id, uuid, deviceInfo, callbackUrl } = authRequest;

    const providerName = op.replace(/^(oidc|oauth2)\//, '');

    // Use getProviderWithSecret to get the full configuration including clientSecret
    // Ensure the cached OIDC configuration includes clientSecret so handleCallback does not get an incomplete cache
    const provider = await this.getProviderWithSecret(providerName);

    if (!provider) {
      throw new BadRequestException(
        `OIDC provider "${providerName}" does not exist or is not enabled`,
      );
    }

    // Validate and save the frontend callback URL
    let frontendRedirectUrl: string | null = null;
    if (callbackUrl) {
      if (!(await this.isCallbackUrlAllowed(callbackUrl))) {
        throw new BadRequestException(
          'callbackUrl is not within the allowed site addresses; please check the site.frontendUrl setting in general settings',
        );
      }
      frontendRedirectUrl = callbackUrl;
    }

    // Generate the authorization code (used for client polling)
    const code = uuidv4();

    // Generate the PKCE code verifier and challenge
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    // Generate the OIDC state and nonce parameters
    const state = client.randomState();
    const isOidc = provider.type === OidcProviderType.OIDC;
    const nonce = isOidc ? client.randomNonce() : undefined;

    // Compute the expiration time
    const expiresAt = new Date();
    expiresAt.setMinutes(
      expiresAt.getMinutes() + this.AUTH_CODE_EXPIRY_MINUTES,
    );

    // Build the callback URL
    const { effectiveBackendUrl } =
      await this.generalSettingsService.getSiteSettings();
    const redirectUri = `${effectiveBackendUrl}/api/oidc/callback`;

    // Save the authorization state
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

    // Get the OIDC configuration and build the authorization URL
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
   * Handle the OIDC callback
   * Callback after OIDC provider authorization; exchanges the authorization code for tokens and user info
   *
   * @param callbackUrl full callback URL (including the code and state parameters)
   * @returns authentication result, including whether it is a Web login, the redirect URL, the access token and user info
   * @throws BadRequestException thrown when the state is invalid or the authorization has expired
   * @throws UnauthorizedException thrown when the token exchange fails
   */
  async handleCallback(callbackUrl: string): Promise<OidcCallbackResult> {
    // Extract the state parameter from the callback URL
    const urlObj = new URL(callbackUrl);
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');

    // Handle errors returned by the OIDC provider
    if (error) {
      const errorDescription =
        urlObj.searchParams.get('error_description') || error;
      this.logger.error(
        `OIDC provider returned error: ${error} - ${errorDescription}`,
      );
      throw new BadRequestException(
        'OIDC authentication failed, please try again',
      );
    }

    if (!state) {
      throw new BadRequestException(
        'OIDC callback is missing the state parameter',
      );
    }

    // Look up the authorization state
    const authState = await this.authStateRepository.findOne({
      where: { state },
    });

    if (!authState) {
      throw new BadRequestException('Invalid OIDC state parameter');
    }

    // Check whether the authorization state has expired
    if (authState.expiresAt < new Date()) {
      authState.status = OidcAuthStatus.EXPIRED;
      await this.authStateRepository.save(authState);
      throw new BadRequestException(
        'OIDC authorization has expired, please start the authorization again',
      );
    }

    // Check whether the authorization state has already been used
    if (authState.status !== OidcAuthStatus.PENDING) {
      throw new BadRequestException('OIDC authorization state is invalid');
    }

    // Get the OIDC provider configuration (including clientSecret)
    const providerName = authState.op.replace(/^(oidc|oauth2)\//, '');
    const provider = await this.getProviderWithSecret(providerName);

    if (!provider) {
      throw new BadRequestException(
        `OIDC provider "${providerName}" does not exist`,
      );
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

      // Find or create the local user
      const user = await this.findOrCreateUser(userInfo, providerName);

      // Create or update the device record (see the implementation in auth.service.ts)
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

      // Generate the JWT token
      const accessToken = await this.generateTokenForUser(
        user,
        authState.deviceId,
        authState.deviceUuid,
      );

      // Update the authorization state to authorized
      authState.status = OidcAuthStatus.AUTHORIZED;
      authState.userGuid = user.guid;
      authState.accessToken = accessToken;
      await this.authStateRepository.save(authState);

      this.logger.log(
        `OIDC auth successful: user=${user.username}, provider=${providerName}`,
      );

      // Determine whether this is a Web frontend login
      const isWebLogin = !!authState.frontendRedirectUrl;

      if (isWebLogin) {
        // Web frontend login: return the full information for the controller to set the cookie
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
        // Client login: return simple information
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
      // Do not expose internal error details to the client
      throw new UnauthorizedException(
        'OIDC authentication failed, please try again',
      );
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
        'OAuth2 token exchange failed: no access_token received',
      );
    }

    const providerName = authState.op.replace(/^(oidc|oauth2)\//, '');
    const provider = await this.getProviderWithSecret(providerName);

    if (!provider) {
      throw new BadRequestException(
        `OAuth2 provider "${providerName}" does not exist`,
      );
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
        'The OAuth2 provider has no user info endpoint configured, unable to get user info',
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
      throw new UnauthorizedException('Failed to get user info');
    }
  }

  /**
   * Query OIDC authorization state
   * Checks whether the OIDC authorization succeeded and returns the access token if so
   *
   * @param code Authorization code
   * @param deviceId device ID
   * @param deviceUuid Device UUID
   * @returns authentication response, including the access token and user info
   * @throws UnauthorizedException thrown when the authorization fails, expires or is cancelled
   */
  async queryAuth(
    code: string,
    deviceId: string,
    deviceUuid: string,
  ): Promise<LoginResponse> {
    // Atomic operation: mark the AUTHORIZED state as CONSUMED to prevent concurrent repeated token retrieval
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
      // No AUTHORIZED state matched; check other states to return an appropriate error message
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

    // Query the record already marked as CONSUMED
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

    // Clean up the authorization state
    await this.authStateRepository.remove(authState);

    return {
      access_token: authState.accessToken,
      type: 'access_token',
      user: {
        guid: user.guid,
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
   * Clear the OIDC configuration cache for the specified issuer
   * Called when an administrator modifies the provider configuration
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
   * Get the OIDC client configuration
   * Prefer OIDC Discovery to get the configuration; on failure, use the endpoints stored in the database
   *
   * @param provider OIDC provider entity (must include clientSecret)
   * @returns openid-client Configuration object
   */
  private async getOidcConfig(
    provider: OidcProvider,
  ): Promise<client.Configuration> {
    const cacheKey = provider.issuer;

    // Check whether the cache is valid
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

      // Discovery failed; build a manual configuration from the endpoints stored in the database
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
   * Get OIDC provider info including clientSecret
   * The clientSecret column is not selected by default (select: false) and must be added explicitly
   *
   * @param name Provider name
   * @returns provider entity including clientSecret
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
   * Find or create the local user
   * Matches an existing user based on the OIDC user info, creating one automatically if none exists
   *
   * Strategy:
   * 1. Only match already-linked OIDC users by OIDC sub + provider
   * 2. Do not automatically link existing accounts by email (prevents account takeover)
   * 3. New users get thirdAuthType set to 'oidc'
   * 4. On username conflict, append a random suffix to handle concurrency races
   *
   * @param oidcUserInfo OIDC user info
   * @param providerName Provider name
   * @returns local user entity
   */
  private async findOrCreateUser(
    oidcUserInfo: OidcUserInfo,
    providerName: string,
  ): Promise<User> {
    // Look up the linked user by OIDC sub (not linked by email, to prevent account takeover)
    const oidcSubject = `oidc:${providerName}:${oidcUserInfo.sub}`;
    const existingUser = await this.userRepository.findOne({
      where: { oidcSubject },
    });
    if (existingUser) {
      return existingUser;
    }

    // Generate the username
    const username =
      oidcUserInfo.preferred_username ||
      oidcUserInfo.name ||
      oidcUserInfo.email?.split('@')[0] ||
      `oidc_${oidcUserInfo.sub.substring(0, 8)}`;

    // Ensure the username is unique, retrying up to 3 times to handle concurrency races
    let finalUsername = username;
    let suffix = 1;
    const maxRetries = 3;
    const userGroupGuid = await this.userGroupService.resolveUserGroupGuid();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Check whether the username already exists
      while (
        await this.userRepository.findOne({
          where: { username: finalUsername },
        })
      ) {
        finalUsername = `${username}_${suffix}`;
        suffix++;
      }

      try {
        // Create a new user
        const userGuid = uuidv4();
        const user = new User();
        user.guid = userGuid;
        user.username = finalUsername;
        // Store the email only if it is verified, so unverified emails are not used for identity linking
        user.email = (
          oidcUserInfo.email_verified ? oidcUserInfo.email : null
        ) as string;
        user.password = null as unknown as string;
        user.status = UserStatus.ACTIVE;
        user.isAdmin = false;
        user.note = `OIDC user (${providerName})`;
        user.thirdAuthType = 'oidc';
        user.oidcSubject = oidcSubject;
        user.userGroupGuid = userGroupGuid;

        await this.userRepository.save(user);
        this.logger.log(
          `OIDC user created: ${finalUsername} via ${providerName}`,
        );
        return user;
      } catch (err: unknown) {
        // Handle unique constraint conflicts under concurrency
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
   * Generate a JWT token for the user
   * Delegates to AuthTokenService to ensure token generation is consistent with password login
   *
   * @param user user object
   * @param deviceId device ID (optional)
   * @param deviceUuid Device UUID (optional)
   * @returns generated JWT token string
   */
  private async generateTokenForUser(
    user: User,
    deviceId?: string,
    deviceUuid?: string,
  ): Promise<string> {
    return this.authTokenService.generateToken(user, deviceId, deviceUuid);
  }
}
