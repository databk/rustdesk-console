import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { User, UserStatus } from '../../user/entities/user.entity';
import { LoginDto } from '../dto/auth.dto';
import { EmailService } from '../../email/email.service';
import { LoginResponse } from '../../../common/interfaces';
import { EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES } from '../auth.constants';
import { LoginSessionService } from './login-session.service';
import { AuthUserHelper } from './auth-user.helper';
import { AuthLoginHelper, LoginContext } from './auth-login.helper';
import { UserPayload } from './auth-response.helper';

@Injectable()
/**
 * AuthEmailService
 * Sub-service responsible for email verification code authentication
 *
 * Relationship to the main service:
 * AuthService delegates email-related operations to it
 *
 * Call context:
 * Includes verification code generation, sending, and verification
 */
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(
    private readonly loginSessionService: LoginSessionService,
    private readonly authUserHelper: AuthUserHelper,
    private readonly authLoginHelper: AuthLoginHelper,
    private emailService: EmailService,
  ) {}

  /**
   * Initiate email verification
   * Generates a 6-digit verification code and sends it by email, used for the second step of login
   *
   * @param user User object
   * @param buildUserPayload Callback that builds the user info payload
   * @returns Login response containing the session identifier secret (actually the guid)
   * @throws BadRequestException Thrown when sending the email fails
   */
  async initiateEmailVerification(
    user: User,
    buildUserPayload: (user: User) => UserPayload,
  ): Promise<LoginResponse> {
    if (!user.email) {
      throw new BadRequestException({
        error: 'User has no email set, cannot perform email verification',
      });
    }

    const code = Math.random().toString().slice(-6);

    const session = await this.loginSessionService.createSession({
      userGuid: user.guid,
      method: 'email',
      email: user.email,
      code,
      expiryMinutes: EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES,
      deleteExisting: true,
    });

    const sent = await this.emailService.sendVerificationCode(user.email, code);
    if (!sent) {
      throw new BadRequestException({
        error:
          'Failed to send the verification code email, please try again later',
      });
    }

    this.logger.log(
      `User ${user.username} login requires email verification; verification code sent to ${user.email}`,
    );

    return {
      type: 'email_check',
      tfa_type: 'email_check',
      secret: session.guid,
      user: buildUserPayload(user),
    };
  }

  /**
   * Email verification code login (second step)
   * Verifies the code entered by the user and completes the login flow
   *
   * @param loginDto Login info
   * @param context Login context (collection of callbacks)
   * @returns Login response
   * @throws BadRequestException Thrown when verification parameters are incomplete
   * @throws UnauthorizedException Thrown when verification fails or the user state is abnormal
   */
  async handleEmailCodeLogin(
    loginDto: LoginDto,
    context: LoginContext,
  ): Promise<LoginResponse> {
    const { username, verificationCode, secret, id, uuid, deviceInfo } =
      loginDto;

    if (!username || !verificationCode || !secret) {
      throw new BadRequestException({
        error: 'Verification parameters are incomplete',
      });
    }

    const session = await this.loginSessionService.findByGuid(secret, {
      method: 'email',
      used: false,
      checkExpiry: true,
    });

    if (!session) {
      throw new UnauthorizedException({
        error: 'Verification code expired or invalid, please log in again',
      });
    }

    if (session.code !== verificationCode) {
      throw new UnauthorizedException({ error: 'Incorrect verification code' });
    }

    const user = await this.authUserHelper.findByUsernameOrEmail(username);

    if (!user || user.guid !== session.userGuid) {
      throw new UnauthorizedException({ error: 'User info mismatch' });
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
      successMessage: `User ${user.username} email verification succeeded, logged in`,
    });
  }
}
