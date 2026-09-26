import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { LoginResponse } from '../../../common/interfaces';
import { DeviceInfoDto } from '../dto/auth.dto';
import { WebAuthnConfigService } from './webauthn-config.service';
import { AuthTokenService } from './auth-token.service';
import { AuthDeviceService } from './auth-device.service';
import { LoginSessionService } from './login-session.service';
import { AuthUserHelper } from './auth-user.helper';
import { AuthResponseHelper, UserPayload } from './auth-response.helper';
import { AuthLoginHelper, LoginContext } from './auth-login.helper';

@Injectable()
export class AuthPasskeyService {
  private readonly logger = new Logger(AuthPasskeyService.name);

  constructor(
    @InjectRepository(PasskeyCredential)
    private credentialRepository: Repository<PasskeyCredential>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly configService: WebAuthnConfigService,
    private readonly tokenService: AuthTokenService,
    private readonly deviceService: AuthDeviceService,
    private readonly loginSessionService: LoginSessionService,
    private readonly authUserHelper: AuthUserHelper,
    private readonly authResponseHelper: AuthResponseHelper,
    private readonly authLoginHelper: AuthLoginHelper,
  ) {}

  // ==================== Registration ====================

  /**
   * Initiate Passkey registration
   * Generates registration options including a challenge and stores them in a temporary session
   *
   * @param userGuid guid of the currently logged-in user
   * @returns Registration options, for the browser to call navigator.credentials.create()
   */
  async beginRegistration(
    userGuid: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({
        error: 'Passkey feature is not enabled',
      });
    }

    const user = await this.userRepository.findOne({
      where: { guid: userGuid },
    });
    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    const existingCredentials = await this.credentialRepository.find({
      where: { userGuid },
    });

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: user.username,
      userDisplayName: user.displayName || user.username,
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

    await this.loginSessionService.createSession({
      userGuid,
      method: 'passkey_reg',
      code: options.challenge,
    });

    this.logger.log(`User ${user.username} initiated Passkey registration`);

    return options;
  }

  /**
   * Verify Passkey registration
   * Verifies the attestation returned by the authenticator and saves the credential on success
   *
   * @param userGuid guid of the currently logged-in user
   * @param response Registration response returned by the browser
   * @param name User-defined credential name
   */
  async verifyRegistration(
    userGuid: string,
    response: RegistrationResponseJSON,
    name?: string,
  ): Promise<{ message: string }> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({
        error: 'Passkey feature is not enabled',
      });
    }

    const session = await this.loginSessionService.findValidSession(
      userGuid,
      'passkey_reg',
    );
    if (!session) {
      throw new BadRequestException({
        error: 'Registration session expired, please start registration again',
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
      this.logger.error(`Passkey registration verification failed: ${error}`);
      throw new BadRequestException({
        error: 'Passkey registration verification failed',
      });
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException({
        error: 'Passkey registration verification failed',
      });
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    const existing = await this.credentialRepository.findOne({
      where: { credentialId: credential.id },
    });
    if (existing) {
      throw new BadRequestException({
        error: 'This credential already exists',
      });
    }

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

    await this.loginSessionService.markSessionUsed(session);

    this.logger.log(`User ${userGuid} successfully bound a Passkey credential`);

    return { message: 'Passkey bound successfully' };
  }

  // ==================== Passwordless login ====================

  /**
   * Initiate Passkey passwordless login
   * Generates authentication options without specifying allowCredentials, so the browser lists available credentials automatically
   *
   * @returns Session identifier and authentication options
   */
  async beginAuthLogin(): Promise<{
    secret: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({
        error: 'Passkey feature is not enabled',
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      userVerification: 'preferred',
    });

    const session = await this.loginSessionService.createSession({
      userGuid: 'pending',
      method: 'passkey',
      code: options.challenge,
    });

    this.logger.log(
      `Initiated Passkey passwordless login, session ${session.guid}`,
    );

    return { secret: session.guid, options };
  }

  /**
   * Verify Passkey login
   * Looks up the user by credentialId, verifies the signature, and issues a JWT
   * Handles both passwordless login and two-factor authentication login
   *
   * @param secret Session identifier
   * @param response Authentication response returned by the browser
   * @param deviceId Device ID
   * @param deviceUuid Device UUID
   * @param deviceInfo Device info
   * @returns Login response containing the JWT token
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
      throw new BadRequestException({
        error: 'Passkey feature is not enabled',
      });
    }

    const session = await this.loginSessionService.findByGuid(secret, {
      used: false,
      checkExpiry: true,
    });

    if (!session) {
      throw new UnauthorizedException({
        error: 'Login session expired or invalid, please log in again',
      });
    }

    if (session.method !== 'passkey' && session.method !== 'passkey_tfa') {
      throw new UnauthorizedException({ error: 'Session type mismatch' });
    }

    const credential = await this.credentialRepository.findOne({
      where: { credentialId: response.id },
    });

    if (!credential) {
      throw new UnauthorizedException({
        error: 'No matching credential found',
      });
    }

    if (
      session.method === 'passkey_tfa' &&
      session.userGuid !== credential.userGuid
    ) {
      throw new UnauthorizedException({
        error: 'Credential does not match the user',
      });
    }

    const user = await this.userRepository.findOne({
      where: { guid: credential.userGuid },
    });

    if (!user) {
      throw new UnauthorizedException({ error: 'User does not exist' });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: 'Account has been disabled' });
    }

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
      this.logger.error(`Passkey login verification failed: ${error}`);
      throw new UnauthorizedException({
        error: 'Passkey authentication failed',
      });
    }

    if (!verification.verified) {
      throw new UnauthorizedException({
        error: 'Passkey authentication failed',
      });
    }

    credential.counter = verification.authenticationInfo.newCounter;
    await this.credentialRepository.save(credential);

    const context: LoginContext = {
      generateToken: (u, devId, devUuid) =>
        this.tokenService.generateToken(u, devId, devUuid, deviceInfo),
      createOrUpdateDevice: (userGuid, devId, devUuid, info) =>
        this.deviceService.createOrUpdateDevice(userGuid, devId, devUuid, info),
      buildUserPayload: (u) => this.authResponseHelper.buildUserPayload(u),
    };

    return this.authLoginHelper.completeLogin({
      user,
      session,
      context,
      deviceId,
      deviceUuid,
      deviceInfo,
      successMessage: `User ${user.username} logged in successfully via Passkey`,
    });
  }

  // ==================== Two-factor authentication ====================

  /**
   * Initiate Passkey two-factor authentication
   * Called after password verification succeeds; generates authentication options and returns them to the client
   *
   * @param user User who has passed password verification
   * @param buildUserPayload Callback that builds the user info payload
   * @returns Login response containing the session identifier and authentication options
   */
  async initiatePasskeyTfa(
    user: User,
    buildUserPayload: (user: User) => UserPayload,
  ): Promise<LoginResponse> {
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException({
        error: 'Passkey feature is not enabled',
      });
    }

    const credentials = await this.credentialRepository.find({
      where: { userGuid: user.guid },
    });

    if (credentials.length === 0) {
      throw new BadRequestException({
        error:
          'No Passkey credential bound, cannot perform two-factor authentication',
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

    const session = await this.loginSessionService.createSession({
      userGuid: user.guid,
      method: 'passkey_tfa',
      code: options.challenge,
      deleteExisting: true,
    });

    this.logger.log(
      `User ${user.username} login requires Passkey two-factor authentication`,
    );

    return {
      type: 'passkey_check',
      secret: session.guid,
      passkey_options: options,
      user: buildUserPayload(user),
    };
  }

  // ==================== Credential management ====================

  /**
   * List all of the user's Passkey credentials
   */
  async listCredentials(userGuid: string): Promise<PasskeyCredential[]> {
    return this.credentialRepository.find({
      where: { userGuid },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Delete the specified Passkey credential
   */
  async deleteCredential(
    userGuid: string,
    credentialGuid: string,
  ): Promise<void> {
    const credential = await this.credentialRepository.findOne({
      where: { guid: credentialGuid, userGuid },
    });

    if (!credential) {
      throw new NotFoundException('Credential does not exist');
    }

    await this.credentialRepository.remove(credential);

    const remaining = await this.credentialRepository.count({
      where: { userGuid },
    });
    if (remaining === 0) {
      await this.setPasskeyTfaEnabled(userGuid, false);
    }

    this.logger.log(
      `User ${userGuid} deleted Passkey credential ${credentialGuid}`,
    );
  }

  /**
   * Check whether the user has a Passkey credential
   */
  async hasCredentials(userGuid: string): Promise<boolean> {
    const count = await this.credentialRepository.count({
      where: { userGuid },
    });
    return count > 0;
  }

  /**
   * Enable/disable Passkey two-factor authentication
   * Stored in UserInfo.other.passkey_tfa_enabled
   */
  async setPasskeyTfaEnabled(
    userGuid: string,
    enabled: boolean,
  ): Promise<{ message: string }> {
    const user = await this.authUserHelper.findByGuid(userGuid, {
      withThirdAuthType: false,
      withAvatar: false,
    });

    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    if (enabled) {
      const hasCredential = await this.hasCredentials(userGuid);
      if (!hasCredential) {
        throw new BadRequestException({
          error:
            'Please bind a Passkey credential before enabling two-factor authentication',
        });
      }
    }

    const userInfo = user.getUserInfo();
    userInfo.other = userInfo.other || {};
    userInfo.other.passkey_tfa_enabled = enabled;
    user.setUserInfo(userInfo);

    await this.userRepository.save(user);

    this.logger.log(
      `User ${userGuid} ${enabled ? 'enabled' : 'disabled'} Passkey two-factor authentication`,
    );

    return {
      message: enabled
        ? 'Passkey two-factor authentication enabled'
        : 'Passkey two-factor authentication disabled',
    };
  }

  /**
   * Check whether the user has enabled Passkey two-factor authentication
   */
  async isPasskeyTfaEnabled(userGuid: string): Promise<boolean> {
    const user = await this.authUserHelper.findByGuid(userGuid, {
      withThirdAuthType: false,
      withAvatar: false,
    });

    if (!user) {
      return false;
    }

    const userInfo = user.getUserInfo();
    return !!userInfo?.other?.passkey_tfa_enabled;
  }
}
