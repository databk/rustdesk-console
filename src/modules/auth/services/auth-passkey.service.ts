import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { User, UserStatus } from '../../user/entities/user.entity';
import { PasskeyCredential } from '../entities/passkey-credential.entity';
import { LoginSession } from '../entities/login-session.entity';
import { LoginResponse } from '../../../common/interfaces';
import { DeviceInfoDto } from '../dto/auth.dto';
import { WebAuthnConfigService } from './webauthn-config.service';
import { AuthTokenService } from './auth-token.service';
import { AuthDeviceService } from './auth-device.service';

/** Passkey 会话有效期（分钟） */
const SESSION_EXPIRY_MINUTES = 5;

@Injectable()
export class AuthPasskeyService {
  private readonly logger = new Logger(AuthPasskeyService.name);

  constructor(
    @InjectRepository(PasskeyCredential)
    private credentialRepository: Repository<PasskeyCredential>,
    @InjectRepository(LoginSession)
    private loginSessionRepository: Repository<LoginSession>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly configService: WebAuthnConfigService,
    private readonly tokenService: AuthTokenService,
    private readonly deviceService: AuthDeviceService,
  ) {}

  // ==================== 注册 ====================

  /**
   * 发起 Passkey 注册
   * 生成注册选项，包含 challenge，存入临时会话
   *
   * @param userGuid 当前登录用户的 guid
   * @returns 注册选项，供浏览器调用 navigator.credentials.create()
   */
  async beginRegistration(
    userGuid: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({ error: 'Passkey 功能未启用' });
    }

    const user = await this.userRepository.findOne({
      where: { guid: userGuid },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // 查询已绑定的凭证，防止同一认证器重复注册
    const existingCredentials = await this.credentialRepository.find({
      where: { userGuid },
    });

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: user.username,
      userDisplayName: user.displayName || user.username,
      // 要求可发现凭证（Passkey），支持无用户名登录
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
      excludeCredentials: existingCredentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      })),
    });

    // 创建临时会话存储 challenge
    await this.createSession(userGuid, 'passkey_reg', options.challenge);

    this.logger.log(`用户 ${user.username} 发起 Passkey 注册`);

    return options;
  }

  /**
   * 验证 Passkey 注册
   * 验证认证器返回的 attestation，通过后保存凭证
   *
   * @param userGuid 当前登录用户的 guid
   * @param response 浏览器返回的注册响应
   * @param name 用户自定义凭证名称
   */
  async verifyRegistration(
    userGuid: string,
    response: RegistrationResponseJSON,
    name?: string,
  ): Promise<{ message: string }> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({ error: 'Passkey 功能未启用' });
    }

    // 查找注册会话获取 challenge
    const session = await this.findValidSession(userGuid, 'passkey_reg');
    if (!session) {
      throw new BadRequestException({
        error: '注册会话已过期，请重新发起注册',
      });
    }

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: session.code!,
        expectedOrigin: config.rpOrigins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.error(`Passkey 注册验证失败: ${error}`);
      throw new BadRequestException({ error: 'Passkey 注册验证失败' });
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException({ error: 'Passkey 注册验证失败' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // 检查凭证是否已存在（防止重复注册）
    const existing = await this.credentialRepository.findOne({
      where: { credentialId: credential.id },
    });
    if (existing) {
      throw new BadRequestException({ error: '该凭证已存在' });
    }

    // 保存凭证
    const passkeyCredential = this.credentialRepository.create({
      guid: uuidv4(),
      userGuid,
      credentialId: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString(
        'base64url',
      ),
      counter: credential.counter,
      transports: credential.transports
        ? JSON.stringify(credential.transports)
        : null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: name || null,
    });

    await this.credentialRepository.save(passkeyCredential);

    // 标记会话已使用
    await this.markSessionUsed(session);

    this.logger.log(`用户 ${userGuid} 成功绑定 Passkey 凭证`);

    return { message: 'Passkey 绑定成功' };
  }

  // ==================== 无密码登录 ====================

  /**
   * 发起 Passkey 无密码登录
   * 生成认证选项，不指定 allowCredentials，浏览器自动列出可用凭证
   *
   * @returns 会话标识符和认证选项
   */
  async beginAuthLogin(): Promise<{
    secret: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({ error: 'Passkey 功能未启用' });
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      // 不指定 allowCredentials，支持发现式凭证（无用户名登录）
      userVerification: 'preferred',
    });

    // 创建临时会话存储 challenge，userGuid 暂为空（登录时通过凭证反查）
    const session = await this.createSession(
      'pending',
      'passkey',
      options.challenge,
    );

    this.logger.log(`发起 Passkey 无密码登录，会话 ${session.guid}`);

    return { secret: session.guid, options };
  }

  /**
   * 验证 Passkey 登录
   * 通过 credentialId 反查用户，验证签名，签发 JWT
   * 同时处理无密码登录和双因素认证登录
   *
   * @param secret 会话标识符
   * @param response 浏览器返回的认证响应
   * @param deviceId 设备 ID
   * @param deviceUuid 设备 UUID
   * @param deviceInfo 设备信息
   * @returns 登录响应，包含 JWT token
   */
  async verifyAuthLogin(
    secret: string,
    response: AuthenticationResponseJSON,
    deviceId?: string,
    deviceUuid?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<LoginResponse> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({ error: 'Passkey 功能未启用' });
    }

    // 查找会话
    const session = await this.loginSessionRepository.findOne({
      where: {
        guid: secret,
        used: false,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!session) {
      throw new UnauthorizedException({
        error: '登录会话已过期或无效，请重新登录',
      });
    }

    if (session.method !== 'passkey' && session.method !== 'passkey_tfa') {
      throw new UnauthorizedException({ error: '会话类型不匹配' });
    }

    // 通过 credentialId 查找凭证
    const credential = await this.credentialRepository.findOne({
      where: { credentialId: response.id },
    });

    if (!credential) {
      throw new UnauthorizedException({ error: '未找到匹配的凭证' });
    }

    // 对于双因素认证，校验凭证所属用户与会话用户一致
    if (
      session.method === 'passkey_tfa' &&
      session.userGuid !== credential.userGuid
    ) {
      throw new UnauthorizedException({ error: '凭证与用户不匹配' });
    }

    // 查找用户
    const user = await this.userRepository.findOne({
      where: { guid: credential.userGuid },
    });

    if (!user) {
      throw new UnauthorizedException({ error: '用户不存在' });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: '账户已被禁用' });
    }

    // 验证认证响应
    const transports = credential.transports
      ? (JSON.parse(credential.transports) as AuthenticatorTransportFuture[])
      : undefined;

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: session.code!,
        expectedOrigin: config.rpOrigins,
        expectedRPID: config.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.credentialPublicKey, 'base64url'),
          counter: credential.counter,
          transports,
        },
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.error(`Passkey 登录验证失败: ${error}`);
      throw new UnauthorizedException({ error: 'Passkey 认证失败' });
    }

    if (!verification.verified) {
      throw new UnauthorizedException({ error: 'Passkey 认证失败' });
    }

    // 更新计数器（防克隆检测）
    credential.counter = verification.authenticationInfo.newCounter;
    await this.credentialRepository.save(credential);

    // 标记会话已使用
    await this.markSessionUsed(session);

    // 创建/更新设备记录
    if (deviceId || deviceUuid) {
      await this.deviceService.createOrUpdateDevice(
        user.guid,
        deviceId,
        deviceUuid,
        deviceInfo,
      );
    }

    // 生成 JWT Token
    const token = await this.tokenService.generateToken(
      user,
      deviceId,
      deviceUuid,
    );

    this.logger.log(`用户 ${user.username} 通过 Passkey 登录成功`);

    return {
      access_token: token,
      type: 'access_token',
      user: this.buildUserPayload(user),
    };
  }

  // ==================== 双因素认证 ====================

  /**
   * 发起 Passkey 双因素认证
   * 密码校验通过后调用，生成认证选项并返回给客户端
   *
   * @param user 已通过密码校验的用户
   * @param buildUserPayload 构建用户信息载荷的回调函数
   * @returns 登录响应，包含会话标识符和认证选项
   */
  async initiatePasskeyTfa(
    user: User,
    buildUserPayload: (user: User) => Record<string, unknown>,
  ): Promise<LoginResponse> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({ error: 'Passkey 功能未启用' });
    }

    // 查找用户绑定的凭证，用于 allowCredentials
    const credentials = await this.credentialRepository.find({
      where: { userGuid: user.guid },
    });

    if (credentials.length === 0) {
      throw new BadRequestException({
        error: '未绑定 Passkey 凭证，无法进行双因素认证',
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: credentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      })),
      userVerification: 'preferred',
    });

    // 清除该用户之前未使用的会话
    await this.loginSessionRepository.delete({
      userGuid: user.guid,
      used: false,
    });

    // 创建 TFA 会话
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + SESSION_EXPIRY_MINUTES);

    const session = this.loginSessionRepository.create({
      guid: uuidv4(),
      userGuid: user.guid,
      method: 'passkey_tfa',
      code: options.challenge,
      expiresAt,
      used: false,
    });
    await this.loginSessionRepository.save(session);

    this.logger.log(`用户 ${user.username} 登录需要 Passkey 双因素认证`);

    return {
      type: 'passkey_check',
      secret: session.guid,
      passkey_options: options,
      user: buildUserPayload(user) as LoginResponse['user'],
    };
  }

  // ==================== 凭证管理 ====================

  /**
   * 列出用户的所有 Passkey 凭证
   */
  async listCredentials(userGuid: string): Promise<PasskeyCredential[]> {
    return this.credentialRepository.find({
      where: { userGuid },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 删除指定 Passkey 凭证
   */
  async deleteCredential(
    userGuid: string,
    credentialGuid: string,
  ): Promise<void> {
    const credential = await this.credentialRepository.findOne({
      where: { guid: credentialGuid, userGuid },
    });

    if (!credential) {
      throw new NotFoundException('凭证不存在');
    }

    await this.credentialRepository.remove(credential);

    // 如果删除后没有凭证了，自动关闭 Passkey TFA
    const remaining = await this.credentialRepository.count({
      where: { userGuid },
    });
    if (remaining === 0) {
      await this.setPasskeyTfaEnabled(userGuid, false);
    }

    this.logger.log(`用户 ${userGuid} 删除了 Passkey 凭证 ${credentialGuid}`);
  }

  /**
   * 检查用户是否有 Passkey 凭证
   */
  async hasCredentials(userGuid: string): Promise<boolean> {
    const count = await this.credentialRepository.count({
      where: { userGuid },
    });
    return count > 0;
  }

  /**
   * 启用/禁用 Passkey 双因素认证
   * 存储在 UserInfo.other.passkey_tfa_enabled 中
   */
  async setPasskeyTfaEnabled(
    userGuid: string,
    enabled: boolean,
  ): Promise<{ message: string }> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: userGuid })
      .addSelect('user.info')
      .getOne();

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (enabled) {
      // 启用前检查是否已绑定凭证
      const hasCredential = await this.hasCredentials(userGuid);
      if (!hasCredential) {
        throw new BadRequestException({
          error: '请先绑定 Passkey 凭证再启用双因素认证',
        });
      }
    }

    const userInfo = user.getUserInfo();
    userInfo.other = userInfo.other || {};
    userInfo.other.passkey_tfa_enabled = enabled;
    user.setUserInfo(userInfo);

    await this.userRepository.save(user);

    this.logger.log(
      `用户 ${userGuid} ${enabled ? '启用' : '禁用'}了 Passkey 双因素认证`,
    );

    return {
      message: enabled
        ? 'Passkey 双因素认证已启用'
        : 'Passkey 双因素认证已禁用',
    };
  }

  /**
   * 检查用户是否启用了 Passkey 双因素认证
   */
  async isPasskeyTfaEnabled(userGuid: string): Promise<boolean> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: userGuid })
      .addSelect('user.info')
      .getOne();

    if (!user) {
      return false;
    }

    const userInfo = user.getUserInfo();
    return !!userInfo?.other?.passkey_tfa_enabled;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 创建临时会话
   */
  private async createSession(
    userGuid: string,
    method: LoginSession['method'],
    challenge: string,
  ): Promise<LoginSession> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + SESSION_EXPIRY_MINUTES);

    const session = this.loginSessionRepository.create({
      guid: uuidv4(),
      userGuid,
      method,
      code: challenge,
      expiresAt,
      used: false,
    });

    return this.loginSessionRepository.save(session);
  }

  /**
   * 查找有效的未使用会话
   */
  private async findValidSession(
    userGuid: string,
    method: LoginSession['method'],
  ): Promise<LoginSession | null> {
    return this.loginSessionRepository.findOne({
      where: {
        userGuid,
        method,
        used: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 标记会话已使用
   */
  private async markSessionUsed(session: LoginSession): Promise<void> {
    session.used = true;
    await this.loginSessionRepository.save(session);
  }

  /**
   * 构建用户信息载荷
   */
  private buildUserPayload(user: User) {
    return {
      name: user.username,
      display_name: user.displayName || undefined,
      email: user.email || undefined,
      note: user.note || undefined,
      status: user.status,
      info: user.getUserInfo(),
      is_admin: user.isAdmin,
      third_auth_type: user.thirdAuthType || undefined,
      ...(user.avatar ? { avatar: user.avatar } : {}),
    };
  }
}
