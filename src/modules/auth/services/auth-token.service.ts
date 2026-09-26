import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { JwtPayload } from '../../../common/services/token.service';
import { DeviceInfoDto } from '../dto/auth.dto';

import { GeneralSettingsService } from '../../settings/services/general-settings.service';

export interface SessionInfo {
  jti: string;
  deviceId: string | null;
  deviceUuid: string | null;
  deviceOs: string | null;
  deviceType: string | null;
  deviceName: string | null;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
/**
 * AuthTokenService
 * Sub-service responsible for JWT token generation and validation
 *
 * Relationship to the main service:
 * AuthService delegates token-related operations to it
 *
 * Call context:
 * Includes token generation, validation, and revocation
 */
export class AuthTokenService {
  constructor(
    @InjectRepository(UserToken)
    private tokenRepository: Repository<UserToken>,
    private jwtService: JwtService,
    private readonly generalSettingsService: GeneralSettingsService,
  ) {}

  /**
   * Generate JWT token
   * Creates a JWT token and saves it to the database for later validation and revocation
   *
   * @param user User object
   * @param deviceId Device ID (optional)
   * @param deviceUuid Device UUID (optional)
   * @param deviceInfo Device info (optional), containing the operating system, source type, and device name
   * @returns The generated JWT token string
   */
  async generateToken(
    user: User,
    deviceId?: string,
    deviceUuid?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<string> {
    const jti = uuidv4();

    const payload: JwtPayload = {
      sub: user.guid,
      username: user.username,
      email: user.email ?? undefined,
      isAdmin: user.isAdmin,
      deviceId,
      jti,
    };

    const expiryDays = await this.generalSettingsService.getJwtExpiryDays();

    const token = this.jwtService.sign(payload, {
      expiresIn: `${expiryDays}d`,
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const userToken = this.tokenRepository.create({
      guid: jti,
      userGuid: user.guid,
      jti,
      deviceId,
      deviceUuid,
      deviceOs: deviceInfo?.os,
      deviceType: deviceInfo?.type,
      deviceName: deviceInfo?.name,
      expiresAt,
    });

    await this.tokenRepository.save(userToken);

    return token;
  }

  /**
   * Validate JWT token
   * Validates the token's signature and expiry and checks whether it has been revoked
   *
   * @param token JWT token string
   * @returns Token payload, or null if validation fails or the token has been revoked
   */
  async validateToken(token: string): Promise<JwtPayload | null> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      // JWT types are compile-time only. Reject malformed signed payloads
      // before they reach a TypeORM where clause, where undefined values may
      // otherwise be ignored.
      if (
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        typeof payload.jti !== 'string' ||
        payload.jti.length === 0
      ) {
        return null;
      }

      const tokenRecord = await this.tokenRepository.findOne({
        where: {
          userGuid: payload.sub,
          jti: payload.jti,
          isRevoked: false,
        },
      });

      if (!tokenRecord) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Revoke the specified token
   * Marks the token as revoked so it can no longer be used for authentication
   *
   * @param userGuid user GUID
   * @param token The token string to revoke
   */
  async revokeToken(userGuid: string, token: string): Promise<void> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      await this.tokenRepository.update(
        { userGuid, jti: payload.jti, isRevoked: false },
        { isRevoked: true },
      );
    } catch {
      // Token is invalid or expired, fail silently
    }
  }

  /**
   * Revoke all tokens for a user's device
   * Revokes all tokens of the given device; usually called on user logout or device removal
   *
   * @param userGuid user GUID
   * @param deviceId Device ID (optional)
   * @param deviceUuid Device UUID (optional)
   */
  async revokeDeviceTokens(
    userGuid: string,
    deviceId?: string,
    deviceUuid?: string,
  ): Promise<void> {
    if (!deviceId && !deviceUuid) return;

    await this.tokenRepository.update(
      {
        userGuid,
        deviceId,
        deviceUuid,
        isRevoked: false,
      },
      { isRevoked: true },
    );
  }

  /**
   * List the user's active login sessions
   * Returns tokens that are neither expired nor revoked, along with their device info
   *
   * @param userGuid user GUID
   * @returns List of active sessions
   */
  async listSessions(userGuid: string): Promise<SessionInfo[]> {
    const tokens = await this.tokenRepository.find({
      where: {
        userGuid,
        isRevoked: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    return tokens.map((t) => ({
      jti: t.jti,
      deviceId: t.deviceId,
      deviceUuid: t.deviceUuid,
      deviceOs: t.deviceOs,
      deviceType: t.deviceType,
      deviceName: t.deviceName,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    }));
  }

  /**
   * Revoke the specified session
   * Revokes one of the user's login sessions by jti
   *
   * @param userGuid user GUID
   * @param jti Unique token identifier
   */
  async revokeSession(userGuid: string, jti: string): Promise<void> {
    const token = await this.tokenRepository.findOne({
      where: { userGuid, jti },
    });

    if (!token) {
      throw new NotFoundException('Session does not exist');
    }

    token.isRevoked = true;
    await this.tokenRepository.save(token);
  }
}
