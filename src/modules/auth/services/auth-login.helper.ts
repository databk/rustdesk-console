import { Injectable, Logger } from '@nestjs/common';
import { User } from '../../user/entities/user.entity';
import { LoginSession } from '../entities/login-session.entity';
import { LoginResponse } from '../../../common/interfaces';
import { DeviceInfoDto } from '../dto/auth.dto';
import { LoginSessionService } from './login-session.service';
import { UserPayload } from './auth-response.helper';

/**
 * Login context
 * Wraps the three callbacks needed to complete a login, replacing the three separate callback parameters previously scattered across handleTfaLogin / handleEmailCodeLogin
 *
 * - generateToken: generates the JWT token (deviceInfo is handled inside the context)
 * - createOrUpdateDevice: creates or updates the device binding record
 * - buildUserPayload: builds the user info payload in the login response
 */
export interface LoginContext {
  generateToken: (
    user: User,
    deviceId?: string,
    deviceUuid?: string,
  ) => Promise<string>;
  createOrUpdateDevice: (
    userGuid: string,
    deviceId?: string,
    deviceUuid?: string,
    deviceInfo?: DeviceInfoDto,
  ) => Promise<void>;
  buildUserPayload: (user: User) => UserPayload;
}

/** Parameters of the completeLogin method */
export interface CompleteLoginParams {
  /** The authenticated user */
  user: User;
  /** The login session to mark as used */
  session: LoginSession;
  /** Login context (collection of callbacks) */
  context: LoginContext;
  /** Device ID */
  deviceId?: string;
  /** Device UUID */
  deviceUuid?: string;
  /** Device info */
  deviceInfo?: DeviceInfoDto;
  /** Success log message */
  successMessage: string;
}

/**
 * Auth login helper
 * Unifies the login completion flow after second-step verification succeeds:
 * mark the session as used -> create/update the device -> generate the token -> build the response
 *
 * eliminating duplicated logic in AuthTfaService / AuthEmailService / AuthPasskeyService
 */
@Injectable()
export class AuthLoginHelper {
  private readonly logger = new Logger(AuthLoginHelper.name);

  constructor(private readonly loginSessionService: LoginSessionService) {}

  /**
   * Complete the login flow
   * Called after second-step verification (TFA / email verification code / Passkey) succeeds,
   * handling session marking, device binding, token generation, and response building in one place
   */
  async completeLogin(params: CompleteLoginParams): Promise<LoginResponse> {
    const {
      user,
      session,
      context,
      deviceId,
      deviceUuid,
      deviceInfo,
      successMessage,
    } = params;

    await this.loginSessionService.markSessionUsed(session);

    if (deviceId || deviceUuid) {
      await context.createOrUpdateDevice(
        user.guid,
        deviceId,
        deviceUuid,
        deviceInfo,
      );
    }

    const token = await context.generateToken(user, deviceId, deviceUuid);

    this.logger.log(successMessage);

    return {
      access_token: token,
      type: 'access_token',
      user: context.buildUserPayload(user),
    };
  }
}
