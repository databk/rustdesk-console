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
 * Authentication service
 * Handles core authentication features such as user registration, login, and logout
 *
 * Supports multiple login methods:
 * - Username/password login (auto-detects LDAP/local authentication)
 * - email verification code login
 * - two-factor authentication login
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
   * User registration
   * Creates a new user account, including username, email, and password validation
   *
   * @param registerDto Registration info, including username, email, password, and remarks
   * @returns Registration result message
   * @throws ConflictException Thrown when the username or email already exists
   */
  async register(registerDto: RegisterDto): Promise<{ message: string }> {
    const { username, email, password, note } = registerDto;

    const existingUser = await this.userRepository.findOne({
      where: [{ username }, { email }],
    });

    if (existingUser) {
      if (existingUser.username === username) {
        throw new ConflictException('Username already exists');
      }
      throw new ConflictException('Email already registered');
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

    this.logger.log(`New user registered successfully: ${username}`);
    return { message: 'Registration successful' };
  }

  /**
   * User login
   * Supports multiple login methods: username/password (auto-detects LDAP/local), email verification code, two-factor authentication
   *
   * LDAP auto-detection strategy (following LDAP best practices):
   * 1. Linked LDAP user (oidcSubject starts with 'ldap:') -> LDAP authentication is enforced
   * 2. LDAP is enabled and the user exists in LDAP -> use LDAP authentication
   * 3. None of the above -> fall back to local username/password authentication
   *
   * @param loginDto Login info, including username, password, device info, etc.
   * @returns Login response; may contain a token or a prompt for further verification
   * @throws BadRequestException Thrown when parameters are incomplete
   * @throws UnauthorizedException Thrown when authentication fails
   */
  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const { type } = loginDto;

    switch (type) {
      case LoginType.EMAIL_CODE:
        return this.handleEmailCodeLogin(loginDto);
      case LoginType.SMS_CODE:
        throw new BadRequestException({
          error:
            'SMS code login is under development and currently unavailable',
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
   * Handle email verification code login (second step)
   * The session's method field is used to distinguish TFA login from email verification code login,
   * instead of using the user-controlled tfaCode field to drive the flow, so attackers cannot bypass verification by manipulating tfaCode
   */
  private async handleEmailCodeLogin(
    loginDto: LoginDto,
  ): Promise<LoginResponse> {
    if (!loginDto.secret) {
      throw new BadRequestException({ error: 'Missing session identifier' });
    }

    const session = await this.loginSessionService.findByGuid(loginDto.secret, {
      used: false,
    });

    if (!session) {
      throw new UnauthorizedException({
        error: 'Login session expired or invalid, please log in again',
      });
    }

    const context = this.createLoginContext(loginDto);

    if (session.method === 'tfa') {
      return this.tfaService.handleTfaLogin(loginDto, context);
    }
    return this.emailAuthService.handleEmailCodeLogin(loginDto, context);
  }

  /**
   * Handle standard username/password login (auto-detects LDAP/local authentication)
   */
  private async handleStandardLogin(
    loginDto: LoginDto,
  ): Promise<LoginResponse> {
    const { username, password, id, uuid, deviceInfo } = loginDto;

    if (!username || !password) {
      throw new BadRequestException({
        error: 'Username and password are required',
      });
    }

    const ldapUser = await this.tryLdapAuthentication(username, password);
    if (ldapUser) {
      return this.buildLoginResponse(ldapUser, id, uuid, deviceInfo);
    }

    return this.localLogin(username, password, id, uuid, deviceInfo);
  }

  /**
   * Create the login context
   * Wraps the generateToken / createOrUpdateDevice / buildUserPayload callbacks,
   * to be called uniformly after second-step verification (TFA / email verification code) succeeds
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
   * Attempt LDAP authentication
   * Follows LDAP best practices: the backend determines the account type automatically, so users do not need to specify it
   *
   * Strategy:
   * 1. Linked LDAP user -> LDAP is enforced (must pass LDAP verification)
   * 2. LDAP is enabled and the user exists in LDAP -> use LDAP authentication
   * 3. LDAP authentication failed -> return null and fall back to local authentication
   *
   * @param username username
   * @param password password
   * @returns The User entity on success, otherwise null
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
      this.logger.debug(
        `LDAP authentication failed, falling back to local authentication: ${username}`,
      );
      return null;
    }
  }

  /**
   * Local username/password login
   *
   * @param username username
   * @param password password
   * @param id Device ID
   * @param uuid Device UUID
   * @returns Login response
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
      throw new UnauthorizedException({
        error: 'Incorrect username or password',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException({
        error: 'Incorrect username or password',
      });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: 'Account has been disabled' });
    }

    if (user.status === UserStatus.UNVERIFIED) {
      throw new UnauthorizedException({
        error: 'Please verify your email first',
      });
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
   * Build the login response
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

    this.logger.log(`User logged in successfully: ${user.username}`);

    return {
      access_token: token,
      type: 'access_token',
      user: this.authResponseHelper.buildUserPayload(user),
    };
  }

  /**
   * Get the current user's info
   * Looks up and returns detailed user info by user GUID
   *
   * @param userGuid The user's GUID
   * @param currentUserDto Current user info (optional)
   * @returns Detailed user info
   * @throws UnauthorizedException Thrown when the user does not exist
   */
  async getCurrentUser(
    userGuid: string,
    _currentUserDto?: CurrentUserDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.authUserHelper.findByGuid(userGuid);

    if (!user) {
      throw new UnauthorizedException('User does not exist');
    }

    return this.authResponseHelper.buildCurrentUserPayload(user);
  }

  /**
   * User logout
   * Revokes the current token and optionally all of the device's tokens
   *
   * Security measures:
   * - Revoke the token currently in use
   * - Revoke all of the device's tokens
   * - Unbind the device from the user
   *
   * @param userGuid The user's GUID
   * @param logoutDto Logout info, including the device ID and UUID
   * @param token The token currently in use (optional)
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

    this.logger.log(`User logged out: ${userGuid}`);
  }

  /**
   * Validate JWT token
   * Delegates token validation to AuthTokenService
   *
   * @param token JWT token string
   * @returns Token payload, or null if validation fails
   */
  async validateToken(token: string): Promise<JwtPayload | null> {
    const payload = await this.tokenService.validateToken(token);
    if (!payload) return null;

    // A valid signature and token row do not prove that the account is still
    // active. Check the current user row so legacy/client routes cannot keep
    // working after an administrator disables or deletes the account.
    const user = await this.userRepository.findOne({
      where: { guid: payload.sub },
      select: ['guid', 'status', 'isAdmin'],
    });
    return user?.status === UserStatus.ACTIVE
      ? { ...payload, isAdmin: user.isAdmin }
      : null;
  }
}
