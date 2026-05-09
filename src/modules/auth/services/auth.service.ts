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
import { User, UserStatus, UserInfo } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { Peer } from '../../../common/entities';
import {
  LoginDto,
  RegisterDto,
  CurrentUserDto,
  LogoutDto,
} from '../dto/auth.dto';
import { EmailVerificationSession } from '../entities/email-verification-session.entity';
import { EmailService } from '../../email/email.service';
import { AuthTokenService } from './auth-token.service';
import { JwtPayload } from '../../../common/services/token.service';
import { AuthTfaService } from './auth-tfa.service';
import { AuthEmailService } from './auth-email.service';
import { AuthDeviceService } from './auth-device.service';

/**
 * 登录响应接口
 * 定义登录成功后返回的数据结构
 */
export interface LoginResponse {
  /** 访问令牌，仅在登录成功时返回 */
  access_token?: string;
  /** 响应类型，用于标识登录流程的状态 */
  type: string;
  /** 双因素认证类型，仅在需要TFA时返回 */
  tfa_type?: string;
  /** TFA密钥，仅在需要TFA时返回 */
  secret?: string;
  /** 用户信息 */
  user?: {
    /** 用户名 */
    name: string;
    /** 邮箱地址 */
    email?: string;
    /** 用户备注 */
    note?: string;
    /** 用户状态 */
    status: number;
    /** 用户信息配置 */
    info?: UserInfo;
    /** 是否为管理员 */
    is_admin: boolean;
    /** 第三方认证类型 */
    third_auth_type?: string;
  };
}

/**
 * 认证服务
 * 负责处理用户注册、登录、登出等核心认证功能
 *
 * 支持多种登录方式：
 * - 账号密码登录
 * - 邮箱验证码登录
 * - 双因素认证登录
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserToken)
    private tokenRepository: Repository<UserToken>,
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(EmailVerificationSession)
    private verificationSessionRepository: Repository<EmailVerificationSession>,
    private readonly emailService: EmailService,
    private readonly tokenService: AuthTokenService,
    private readonly tfaService: AuthTfaService,
    private readonly emailAuthService: AuthEmailService,
    private readonly deviceService: AuthDeviceService,
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

    // 检查用户名或邮箱是否已被注册
    const existingUser = await this.userRepository.findOne({
      where: [{ username }, { email }],
    });

    if (existingUser) {
      if (existingUser.username === username) {
        throw new ConflictException('用户名已存在');
      }
      throw new ConflictException('邮箱已被注册');
    }

    // 使用bcrypt加密密码，强度为10
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户
    const user = this.userRepository.create({
      guid: uuidv4(),
      username,
      email,
      password: hashedPassword,
      note: note || '',
      status: UserStatus.ACTIVE,
      isAdmin: false,
    });

    await this.userRepository.save(user);

    this.logger.log(`新用户注册成功: ${username}`);
    return { message: '注册成功' };
  }

  /**
   * 用户登录
   * 支持多种登录方式：账号密码、邮箱验证码、双因素认证
   *
   * 登录流程：
   * 1. 普通登录 -> 检查是否需要邮箱验证或TFA
   * 2. 邮箱验证码 -> 第二步验证
   * 3. TFA验证 -> 双因素认证
   *
   * @param loginDto 登录信息，包含用户名、密码、设备信息等
   * @returns 登录响应，可能包含token或需要进一步验证的提示
   * @throws BadRequestException 当参数不完整时抛出
   * @throws UnauthorizedException 当认证失败时抛出
   */
  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const { username, password, id, uuid, type, tfaCode, deviceInfo } =
      loginDto;

    // 处理邮箱验证码登录（第二步）
    if (type === 'email_code') {
      return this.emailAuthService.handleEmailCodeLogin(
        loginDto,
        (user, deviceId, deviceUuid) =>
          this.tokenService.generateToken(user, deviceId, deviceUuid),
        (userGuid, deviceId, deviceUuid, deviceInfo) =>
          this.deviceService.createOrUpdateDevice(
            userGuid,
            deviceId,
            deviceUuid,
            deviceInfo,
          ),
      );
    }

    // 短信验证码登录功能暂未实现
    if (type === 'sms_code') {
      throw new BadRequestException('短信验证码登录功能正在开发中，暂时不可用');
    }

    // 处理双因素认证登录
    if (type === 'tfa_code') {
      return this.tfaService.handleTfaLogin(
        loginDto,
        (user, deviceId, deviceUuid) =>
          this.tokenService.generateToken(user, deviceId, deviceUuid),
        (userGuid, deviceId, deviceUuid, deviceInfo) =>
          this.deviceService.createOrUpdateDevice(
            userGuid,
            deviceId,
            deviceUuid,
            deviceInfo,
          ),
      );
    }

    // 标准账号密码登录
    if (!username || !password) {
      throw new BadRequestException('用户名和密码不能为空');
    }

    // 查找用户（支持用户名或邮箱登录）
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.username = :username OR user.email = :email', {
        username,
        email: username,
      })
      .addSelect('user.password')
      .addSelect('user.tfaSecret')
      .addSelect('user.info')
      .addSelect('user.thirdAuthType')
      .getOne();

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 检查用户状态
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException('账户已被禁用');
    }

    if (user.status === UserStatus.UNVERIFIED) {
      throw new UnauthorizedException('请先验证邮箱');
    }

    // 检查是否需要邮箱验证（用户设置中开启了email_verification）
    const userInfo = user.getUserInfo();
    if (userInfo?.email_verification && user.email) {
      return this.emailAuthService.initiateEmailVerification(user);
    }

    // 检查是否需要双因素认证
    if (user.tfaSecret) {
      if (!tfaCode) {
        // 返回TFA验证提示
        return {
          type: 'email_check',
          tfa_type: 'tfa_check',
          secret: user.tfaSecret,
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
      // 验证TFA代码
      const isValidTfa = this.tfaService.verifyTfaCode(user.tfaSecret, tfaCode);
      if (!isValidTfa) {
        throw new UnauthorizedException('双因素认证验证码错误');
      }
    }

    // 创建或更新设备记录
    if (id || uuid) {
      await this.deviceService.createOrUpdateDevice(
        user.guid,
        id,
        uuid,
        deviceInfo,
      );
    }

    // 生成JWT Token
    const token = await this.tokenService.generateToken(user, id, uuid);

    this.logger.log(`用户登录成功: ${username}`);

    return {
      access_token: token,
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
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: userGuid })
      .addSelect('user.info')
      .addSelect('user.thirdAuthType')
      .getOne();

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return {
      name: user.username,
      email: user.email || undefined,
      note: user.note || undefined,
      verifier: user.verifier || undefined,
      status: user.status,
      info: user.getUserInfo(),
      is_admin: user.isAdmin,
      third_auth_type: user.thirdAuthType || undefined,
    };
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

    // 优先撤销当前token
    if (token) {
      await this.tokenService.revokeToken(userGuid, token);
    }

    // 如果提供了设备信息，撤销该设备的所有token并解除设备绑定
    if (id || uuid) {
      // 撤销该设备的所有token
      await this.tokenService.revokeDeviceTokens(userGuid, id, uuid);

      // 解除设备与用户的绑定（安全关键：防止退出登录后设备仍关联用户）
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
