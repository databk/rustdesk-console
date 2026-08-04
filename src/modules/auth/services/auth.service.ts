import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { User, UserStatus } from '../../user/entities/user.entity';
import { LoginResponse } from '../../../common/interfaces';
import {
  LoginDto,
  RegisterDto,
  CurrentUserDto,
  LogoutDto,
  DeviceInfoDto,
} from '../dto/auth.dto';
import { LoginType } from '../auth.constants';
import { AuthTokenService } from './auth-token.service';
import { JwtPayload } from '../../../common/services/token.service';
import { AuthTfaService } from './auth-tfa.service';
import { AuthEmailService } from './auth-email.service';
import { AuthDeviceService } from './auth-device.service';
import { AuthPasskeyService } from './auth-passkey.service';
import { LdapService } from '../../ldap/ldap.service';
import { UserGroupService } from '../../user-group/user-group.service';
import { AuthUserHelper } from './auth-user.helper';
import { AuthResponseHelper } from './auth-response.helper';
import { LoginSessionService } from './login-session.service';
import { LoginContext } from './auth-login.helper';

/**
 * 认证服务
 * 负责处理用户注册、登录、登出等核心认证功能
 *
 * 支持多种登录方式：
 * - 账号密码登录（自动检测 LDAP/本地认证）
 * - 邮箱验证码登录
 * - 双因素认证登录
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly tokenService: AuthTokenService,
    private readonly tfaService: AuthTfaService,
    private readonly emailAuthService: AuthEmailService,
    private readonly deviceService: AuthDeviceService,
    private readonly passkeyService: AuthPasskeyService,
    private readonly ldapService: LdapService,
    private readonly userGroupService: UserGroupService,
    private readonly authUserHelper: AuthUserHelper,
    private readonly authResponseHelper: AuthResponseHelper,
    private readonly loginSessionService: LoginSessionService,
  ) {}

  /**
   * 用户注册
   * 创建新用户账户，包括用户名、邮箱和密码验证
   *
   * @param registerDto 注册信息，包含用户名、邮箱、密码和备注
   * @returns 注册结果消息
   * @throws ConflictException 当用户名或邮箱已存在时抛出
   */
  async register(registerDto: RegisterDto): Promise<{ message: string }> {
    const { username, email, password, note } = registerDto;

    const existingUser = await this.userRepository.findOne({
      where: [{ username }, { email }],
    });

    if (existingUser) {
      if (existingUser.username === username) {
        throw new ConflictException('用户名已存在');
      }
      throw new ConflictException('邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userGroupGuid = await this.userGroupService.resolveUserGroupGuid();

    const user = this.userRepository.create({
      guid: uuidv4(),
      username,
      email,
      password: hashedPassword,
      note: note || '',
      status: UserStatus.ACTIVE,
      isAdmin: false,
      userGroupGuid,
    });

    await this.userRepository.save(user);

    this.logger.log(`新用户注册成功: ${username}`);
    return { message: '注册成功' };
  }

  /**
   * 用户登录
   * 支持多种登录方式：账号密码（自动检测 LDAP/本地）、邮箱验证码、双因素认证
   *
   * LDAP 自动检测策略（遵循 LDAP 最佳实践）：
   * 1. 已关联的 LDAP 用户（oidcSubject 以 'ldap:' 开头）→ 强制走 LDAP 认证
   * 2. LDAP 已启用且用户在 LDAP 中存在 → 走 LDAP 认证
   * 3. 以上均不满足 → 回退到本地账号密码认证
   *
   * @param loginDto 登录信息，包含用户名、密码、设备信息等
   * @returns 登录响应，可能包含token或需要进一步验证的提示
   * @throws BadRequestException 当参数不完整时抛出
   * @throws UnauthorizedException 当认证失败时抛出
   */
  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const { type } = loginDto;

    switch (type) {
      case LoginType.EMAIL_CODE:
        return this.handleEmailCodeLogin(loginDto);
      case LoginType.SMS_CODE:
        throw new BadRequestException({
          error: '短信验证码登录功能正在开发中，暂时不可用',
        });
      case LoginType.TFA_CODE:
        return this.tfaService.handleTfaLogin(
          loginDto,
          this.createLoginContext(loginDto),
        );
      default:
        return this.handleStandardLogin(loginDto);
    }
  }

  /**
   * 处理邮箱验证码登录（第二步验证）
   * 通过会话的 method 字段区分 TFA 登录与邮箱验证码登录，
   * 而非使用用户可控的 tfaCode 字段控制流程，避免攻击者通过操控 tfaCode 绕过验证
   */
  private async handleEmailCodeLogin(
    loginDto: LoginDto,
  ): Promise<LoginResponse> {
    if (!loginDto.secret) {
      throw new BadRequestException({ error: '缺少会话标识符' });
    }

    const session = await this.loginSessionService.findByGuid(loginDto.secret, {
      used: false,
    });

    if (!session) {
      throw new UnauthorizedException({
        error: '登录会话已过期或无效，请重新登录',
      });
    }

    const context = this.createLoginContext(loginDto);

    if (session.method === 'tfa') {
      return this.tfaService.handleTfaLogin(loginDto, context);
    }
    return this.emailAuthService.handleEmailCodeLogin(loginDto, context);
  }

  /**
   * 处理标准账号密码登录（自动检测 LDAP/本地认证）
   */
  private async handleStandardLogin(
    loginDto: LoginDto,
  ): Promise<LoginResponse> {
    const { username, password, id, uuid, deviceInfo } = loginDto;

    if (!username || !password) {
      throw new BadRequestException({ error: '用户名和密码不能为空' });
    }

    const ldapUser = await this.tryLdapAuthentication(username, password);
    if (ldapUser) {
      return this.buildLoginResponse(ldapUser, id, uuid, deviceInfo);
    }

    return this.localLogin(username, password, id, uuid, deviceInfo);
  }

  /**
   * 创建登录上下文
   * 封装 generateToken / createOrUpdateDevice / buildUserPayload 三个回调，
   * 供二次验证（TFA / 邮箱验证码）通过后统一调用
   */
  private createLoginContext(loginDto: LoginDto): LoginContext {
    return {
      generateToken: (user, deviceId, deviceUuid) =>
        this.tokenService.generateToken(
          user,
          deviceId,
          deviceUuid,
          loginDto.deviceInfo,
        ),
      createOrUpdateDevice: (userGuid, deviceId, deviceUuid, deviceInfo) =>
        this.deviceService.createOrUpdateDevice(
          userGuid,
          deviceId,
          deviceUuid,
          deviceInfo,
        ),
      buildUserPayload: (user) =>
        this.authResponseHelper.buildUserPayload(user),
    };
  }

  /**
   * 尝试 LDAP 认证
   * 遵循 LDAP 最佳实践：后端自动判断账号类型，用户无需指定
   *
   * 策略：
   * 1. 已关联的 LDAP 用户 → 强制走 LDAP（必须通过 LDAP 验证）
   * 2. LDAP 已启用且用户在 LDAP 中存在 → 走 LDAP 认证
   * 3. LDAP 认证失败 → 返回 null，回退本地认证
   *
   * @param username 用户名
   * @param password 密码
   * @returns 认证成功返回 User 实体，否则返回 null
   */
  private async tryLdapAuthentication(
    username: string,
    password: string,
  ): Promise<User | null> {
    const isLinkedLdapUser = await this.ldapService.isLinkedLdapUser(username);

    if (isLinkedLdapUser) {
      return this.ldapService.authenticate(username, password);
    }

    const ldapEnabled = await this.ldapService.isEnabled();
    if (!ldapEnabled) {
      return null;
    }

    try {
      return await this.ldapService.authenticate(username, password);
    } catch {
      this.logger.debug(`LDAP 认证失败，回退本地认证: ${username}`);
      return null;
    }
  }

  /**
   * 本地账号密码登录
   *
   * @param username 用户名
   * @param password 密码
   * @param id 设备 ID
   * @param uuid 设备 UUID
   * @returns 登录响应
   */
  private async localLogin(
    username: string,
    password: string,
    id?: string,
    uuid?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<LoginResponse> {
    const user = await this.authUserHelper.findByUsernameOrEmail(username, {
      withPassword: true,
      withTfaSecret: true,
    });

    if (!user) {
      throw new UnauthorizedException({ error: '用户名或密码错误' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException({ error: '用户名或密码错误' });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: '账户已被禁用' });
    }

    if (user.status === UserStatus.UNVERIFIED) {
      throw new UnauthorizedException({ error: '请先验证邮箱' });
    }

    const userInfo = user.getUserInfo();
    const buildPayload = (u: User) =>
      this.authResponseHelper.buildUserPayload(u);

    if (userInfo?.email_verification && user.email) {
      return this.emailAuthService.initiateEmailVerification(
        user,
        buildPayload,
      );
    }

    if (userInfo?.other?.passkey_tfa_enabled) {
      const hasPasskey = await this.passkeyService.hasCredentials(user.guid);
      if (hasPasskey) {
        return this.passkeyService.initiatePasskeyTfa(user, buildPayload);
      }
    }

    if (user.tfaSecret) {
      return this.tfaService.initiateTfaLogin(user, buildPayload);
    } else if (userInfo?.other?.tfa_enforce) {
      return {
        type: 'enforce_tfa',
        user: buildPayload(user),
      };
    }

    return this.buildLoginResponse(user, id, uuid, deviceInfo);
  }

  /**
   * 构建登录响应
   */
  private async buildLoginResponse(
    user: User,
    id?: string,
    uuid?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<LoginResponse> {
    if (id || uuid) {
      await this.deviceService.createOrUpdateDevice(
        user.guid,
        id,
        uuid,
        deviceInfo,
      );
    }

    const token = await this.tokenService.generateToken(
      user,
      id,
      uuid,
      deviceInfo,
    );

    this.logger.log(`用户登录成功: ${user.username}`);

    return {
      access_token: token,
      type: 'access_token',
      user: this.authResponseHelper.buildUserPayload(user),
    };
  }

  /**
   * 获取当前用户信息
   * 根据用户GUID查询并返回用户详细信息
   *
   * @param userGuid 用户的GUID
   * @param currentUserDto 当前用户信息（可选）
   * @returns 用户详细信息
   * @throws UnauthorizedException 当用户不存在时抛出
   */
  async getCurrentUser(
    userGuid: string,
    _currentUserDto?: CurrentUserDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.authUserHelper.findByGuid(userGuid);

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return this.authResponseHelper.buildCurrentUserPayload(user);
  }

  /**
   * 用户登出
   * 撤销当前token，并可选择撤销设备的所有token
   *
   * 安全措施：
   * - 撤销当前使用的token
   * - 撤销设备的所有token
   * - 解除设备与用户的绑定
   *
   * @param userGuid 用户的GUID
   * @param logoutDto 登出信息，包含设备ID和UUID
   * @param token 当前使用的token（可选）
   */
  async logout(
    userGuid: string,
    logoutDto: LogoutDto,
    token?: string | null,
  ): Promise<void> {
    const { id, uuid } = logoutDto;

    if (token) {
      await this.tokenService.revokeToken(userGuid, token);
    }

    if (id || uuid) {
      await this.tokenService.revokeDeviceTokens(userGuid, id, uuid);

      if (uuid) {
        await this.deviceService.unbindDevice(userGuid, uuid);
      }
    }

    this.logger.log(`用户登出: ${userGuid}`);
  }

  /**
   * 验证JWT Token
   * 委托给AuthTokenService进行token验证
   *
   * @param token JWT令牌字符串
   * @returns 令牌负载，验证失败返回null
   */
  async validateToken(token: string): Promise<JwtPayload | null> {
    return this.tokenService.validateToken(token);
  }
}
