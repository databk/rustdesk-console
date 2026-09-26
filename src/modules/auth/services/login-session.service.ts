import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoginSession } from '../entities/login-session.entity';
import { PASSKEY_SESSION_EXPIRY_MINUTES } from '../auth.constants';

/** Parameters for creating a login session */
export interface CreateSessionParams {
  /** GUID of the owning user */
  userGuid: string;
  /** Verification method */
  method: LoginSession['method'];
  /** Verification code / challenge (email verification code or WebAuthn challenge) */
  code?: string;
  /** Email to verify (email verification method only) */
  email?: string;
  /** Session validity period (minutes); defaults to the Passkey session validity constant */
  expiryMinutes?: number;
  /** Whether to first delete the user's unused sessions; defaults to false */
  deleteExisting?: boolean;
}

/**
 * Login session service
 * Centrally manages creation, lookup, marking, and cleanup of second-step login verification sessions,
 * eliminating duplicated logic in AuthTfaService / AuthEmailService / AuthPasskeyService
 */
@Injectable()
export class LoginSessionService {
  constructor(
    @InjectRepository(LoginSession)
    private readonly loginSessionRepository: Repository<LoginSession>,
  ) {}

  /**
   * Create a login session
   * Optionally clears the user's previously unused sessions first to avoid session buildup
   */
  async createSession(params: CreateSessionParams): Promise<LoginSession> {
    const {
      userGuid,
      method,
      code,
      email,
      expiryMinutes = PASSKEY_SESSION_EXPIRY_MINUTES,
      deleteExisting = false,
    } = params;

    if (deleteExisting) {
      await this.deleteUserUnusedSessions(userGuid);
    }

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expiryMinutes);

    const session = this.loginSessionRepository.create({
      guid: uuidv4(),
      userGuid,
      method,
      email,
      code,
      expiresAt,
      used: false,
    });

    return this.loginSessionRepository.save(session);
  }

  /**
   * Find the user's latest valid unused session for the given method
   */
  async findValidSession(
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
   * Find a session by session GUID
   * Can optionally filter by method / used / expiry
   */
  async findByGuid(
    guid: string,
    options: {
      method?: LoginSession['method'];
      used?: boolean;
      checkExpiry?: boolean;
    } = {},
  ): Promise<LoginSession | null> {
    const where: Record<string, unknown> = { guid };

    if (options.method !== undefined) {
      where.method = options.method;
    }
    if (options.used !== undefined) {
      where.used = options.used;
    }
    if (options.checkExpiry) {
      where.expiresAt = MoreThan(new Date());
    }

    return this.loginSessionRepository.findOne({ where });
  }

  /**
   * Mark the session as used to prevent replay attacks
   */
  async markSessionUsed(session: LoginSession): Promise<void> {
    const result = await this.loginSessionRepository.update(
      { guid: session.guid, used: false, expiresAt: MoreThan(new Date()) },
      { used: true },
    );
    if (result.affected !== 1) {
      throw new UnauthorizedException('Login session already used or revoked');
    }
    session.used = true;
  }

  /**
   * Delete all of the given user's unused sessions
   * Called before starting a new second-step verification to avoid session buildup
   */
  async deleteUserUnusedSessions(userGuid: string): Promise<void> {
    await this.loginSessionRepository.delete({
      userGuid,
      used: false,
    });
  }

  async revokeUserSessions(userGuid: string): Promise<void> {
    await this.deleteUserUnusedSessions(userGuid);
  }
}
