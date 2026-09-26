import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import { User, UserStatus } from '../../user/entities/user.entity';
import { LoginDto } from '../dto/auth.dto';
import { LoginResponse } from '../../../common/interfaces';
import { TFA_LOGIN_SESSION_EXPIRY_MINUTES } from '../auth.constants';
import { LoginSessionService } from './login-session.service';
import { AuthUserHelper } from './auth-user.helper';
import { AuthLoginHelper, LoginContext } from './auth-login.helper';
import { UserPayload } from './auth-response.helper';

@Injectable()
export class AuthTfaService {
  private readonly logger = new Logger(AuthTfaService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly loginSessionService: LoginSessionService,
    private readonly authUserHelper: AuthUserHelper,
    private readonly authLoginHelper: AuthLoginHelper,
  ) {}

  verifyTfaCode(secret: string, code: string): boolean {
    try {
      return authenticator.verify({
        secret,
        token: code,
      });
    } catch (error) {
      this.logger.error('TFA verification failed', error);
      return false;
    }
  }

  async setupTfa(
    userGuid: string,
    currentCode?: string,
  ): Promise<{ secret: string; otpauth_url: string }> {
    const user = await this.authUserHelper.findByGuid(userGuid, {
      withTfaSecret: true,
      withThirdAuthType: false,
      withAvatar: false,
    });

    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    const userInfo = user.getUserInfo();
    const isEnforced = !!userInfo?.other?.tfa_enforce;

    if (user.tfaSecret) {
      if (!isEnforced) {
        throw new BadRequestException(
          '2FA is already enabled; disable it first to set it up again',
        );
      }

      if (!currentCode) {
        throw new BadRequestException(
          '2FA is enabled and enforced; the current verification code is required to reset it',
        );
      }

      const isValid = this.verifyTfaCode(user.tfaSecret, currentCode);
      if (!isValid) {
        throw new UnauthorizedException(
          'Current verification code is incorrect',
        );
      }
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.username, 'RustDesk', secret);

    userInfo.other = userInfo.other || {};
    userInfo.other.tfa_pending_secret = secret;
    user.setUserInfo(userInfo);

    await this.userRepository.save(user);

    return {
      secret,
      otpauth_url: otpauthUrl,
    };
  }

  async verifyAndBindTfa(
    userGuid: string,
    code: string,
  ): Promise<{ message: string }> {
    const user = await this.authUserHelper.findByGuid(userGuid, {
      withTfaSecret: true,
      withThirdAuthType: false,
      withAvatar: false,
    });

    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    const userInfo = user.getUserInfo();
    const isEnforced = !!userInfo?.other?.tfa_enforce;

    if (user.tfaSecret && !isEnforced) {
      throw new BadRequestException('2FA already enabled');
    }

    const other = userInfo.other || {};
    const pendingSecret = other.tfa_pending_secret as string | undefined;

    if (!pendingSecret) {
      throw new BadRequestException(
        'Please call the setup endpoint to generate a 2FA secret first',
      );
    }

    const isValid = this.verifyTfaCode(pendingSecret, code);
    if (!isValid) {
      throw new UnauthorizedException(
        'Incorrect verification code, please try again',
      );
    }

    user.tfaSecret = pendingSecret;

    delete other.tfa_pending_secret;
    userInfo.other = other;
    user.setUserInfo(userInfo);

    await this.userRepository.save(user);

    return { message: '2FA bound successfully' };
  }

  async disableTfa(
    userGuid: string,
    code: string,
  ): Promise<{ message: string }> {
    const user = await this.authUserHelper.findByGuid(userGuid, {
      withTfaSecret: true,
      withThirdAuthType: false,
      withAvatar: false,
    });

    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    if (!user.tfaSecret) {
      throw new BadRequestException('2FA is not enabled');
    }

    const userInfo = user.getUserInfo();
    if (userInfo?.other?.tfa_enforce) {
      throw new BadRequestException(
        'The administrator requires 2FA to be enabled; it cannot be disabled',
      );
    }

    const isValid = this.verifyTfaCode(user.tfaSecret, code);
    if (!isValid) {
      throw new UnauthorizedException('Incorrect verification code');
    }

    user.tfaSecret = '';
    await this.userRepository.save(user);

    return { message: '2FA disabled' };
  }

  /**
   * Initiate TFA login verification
   * Called after password verification succeeds when the user has TFA enabled.
   *
   * Security note:
   * Creates a one-time login session; the returned secret field is actually the session's guid (UUID).
   * The client sends this value back via the secret field during second-step verification.
   * The TFA secret (tfaSecret) always stays on the server and is never returned to the client.
   *
   * @param user User who has passed password verification
   * @param buildUserPayload Callback that builds the user info payload
   * @returns Login response containing the session identifier secret (actually the guid); type is email_check for client compatibility
   */
  async initiateTfaLogin(
    user: User,
    buildUserPayload: (user: User) => UserPayload,
  ): Promise<LoginResponse> {
    const session = await this.loginSessionService.createSession({
      userGuid: user.guid,
      method: 'tfa',
      expiryMinutes: TFA_LOGIN_SESSION_EXPIRY_MINUTES,
      deleteExisting: true,
    });

    this.logger.log(
      `User ${user.username} login requires TFA verification; session created`,
    );

    return {
      type: 'email_check',
      tfa_type: 'tfa_check',
      secret: session.guid,
      user: buildUserPayload(user),
    };
  }

  /**
   * Handle TFA login (second step)
   * Verifies the TFA code submitted by the user and completes the login flow
   *
   * @param loginDto Login info
   * @param context Login context (collection of callbacks)
   * @returns Login response
   */
  async handleTfaLogin(
    loginDto: LoginDto,
    context: LoginContext,
  ): Promise<LoginResponse> {
    const { username, tfaCode, secret, id, uuid, deviceInfo } = loginDto;

    if (!tfaCode || !secret) {
      throw new BadRequestException({
        error: 'Two-factor authentication parameters are incomplete',
      });
    }

    const session = await this.loginSessionService.findByGuid(secret, {
      method: 'tfa',
      used: false,
      checkExpiry: true,
    });

    if (!session) {
      throw new UnauthorizedException({
        error: 'Login session expired or invalid, please log in again',
      });
    }

    const user = await this.authUserHelper.findByGuid(session.userGuid, {
      withTfaSecret: true,
    });

    if (!user) {
      throw new UnauthorizedException({ error: 'User does not exist' });
    }

    if (username && user.username !== username && user.email !== username) {
      throw new UnauthorizedException({ error: 'User info mismatch' });
    }

    if (!user.tfaSecret) {
      throw new UnauthorizedException({
        error: 'Two-factor authentication parameters are invalid',
      });
    }

    const isValidTfa = this.verifyTfaCode(user.tfaSecret, tfaCode);
    if (!isValidTfa) {
      throw new UnauthorizedException({
        error: 'Incorrect two-factor authentication code',
      });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: 'Account has been disabled' });
    }

    return this.authLoginHelper.completeLogin({
      user,
      session,
      context,
      deviceId: id,
      deviceUuid: uuid,
      deviceInfo,
      successMessage: `User ${user.username} TFA authentication succeeded, logged in`,
    });
  }
}
