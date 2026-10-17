import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { User, UserStatus } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { LoginSession } from '../entities/login-session.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import {
  PASSWORD_RESET_TOKEN_BYTES,
  PASSWORD_RESET_EXPIRY_MINUTES,
} from '../auth.constants';
import { EmailService } from '../../email/email.service';
import { GeneralSettingsService } from '../../settings/services/general-settings.service';
import { SmtpSettingsService } from '../../settings/services/smtp-settings.service';
import { AuthUserHelper } from './auth-user.helper';
import {
  RequestPasswordResetDto,
  ConfirmPasswordResetDto,
} from '../dto/password-reset.dto';

@Injectable()
/**
 * PasswordResetService
 * Implements the self-service password reset flow based on one-time email links
 *
 * Flow:
 * 1. requestReset: the user submits a username or email; if the account is eligible,
 *    a one-time reset token is generated and emailed as a link
 * 2. validateResetToken: the reset page checks whether the token is still valid
 * 3. confirmReset: the user submits a new password with the token; the password is
 *    updated and all active sessions of the user are revoked
 *
 * Security notes:
 * - requestReset always returns the same message regardless of whether the account
 *   exists, to prevent user enumeration
 * - Tokens are cryptographically secure random strings, single-use, and short-lived
 * - confirmReset marks the token as used atomically to prevent replay attacks
 */
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(UserToken)
    private readonly userTokenRepository: Repository<UserToken>,
    @InjectRepository(LoginSession)
    private readonly loginSessionRepository: Repository<LoginSession>,
    private readonly authUserHelper: AuthUserHelper,
    private readonly emailService: EmailService,
    private readonly generalSettingsService: GeneralSettingsService,
    private readonly smtpSettingsService: SmtpSettingsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Request a password reset link
   * Always returns the same response to avoid leaking which accounts exist
   */
  async requestReset(
    dto: RequestPasswordResetDto,
  ): Promise<{ message: string }> {
    const smtpConfig = await this.smtpSettingsService.getActiveConfig();
    if (!smtpConfig) {
      throw new BadRequestException({
        error:
          'Email service is not enabled, please contact the administrator to reset the password',
      });
    }

    const user = await this.authUserHelper.findByUsernameOrEmail(
      dto.username_or_email,
    );

    const eligible =
      !!user &&
      !!user.email &&
      !user.thirdAuthType &&
      user.status === UserStatus.ACTIVE;

    if (eligible && user && user.email) {
      const token = crypto
        .randomBytes(PASSWORD_RESET_TOKEN_BYTES)
        .toString('hex');
      const expiresAt = new Date(
        Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
      );

      await this.passwordResetTokenRepository.delete({ userGuid: user.guid });

      const record = new PasswordResetToken();
      record.guid = crypto.randomUUID();
      record.token = token;
      record.userGuid = user.guid;
      record.expiresAt = expiresAt;
      record.usedAt = null;
      await this.passwordResetTokenRepository.save(record);

      const { effectiveFrontendUrl } =
        await this.generalSettingsService.getSiteSettings();
      const resetUrl = `${effectiveFrontendUrl}/#/user/reset-password?token=${token}`;
      const sent = await this.emailService.sendPasswordResetEmail(
        user.email,
        resetUrl,
        `${PASSWORD_RESET_EXPIRY_MINUTES} minutes`,
      );
      if (!sent) {
        throw new BadRequestException({
          error:
            'Failed to send the password reset email, please try again later',
        });
      }

      this.logger.log(
        `Password reset link for user ${user.username} sent to ${user.email}`,
      );
    }

    return {
      message:
        'If the account exists and has a bound email address, a password reset link has been sent',
    };
  }

  /**
   * Validate a reset token and return the account info for display
   */
  async validateResetToken(token: string): Promise<{
    username: string;
    display_name: string;
  }> {
    const { user } = await this.getTokenWithUser(token);
    return {
      username: user.username,
      display_name: user.displayName || '',
    };
  }

  /**
   * Confirm the password reset
   * Sets the new password, consumes the token, and revokes all active sessions
   */
  async confirmReset(dto: ConfirmPasswordResetDto): Promise<{
    message: string;
    username: string;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const { user, record } = await this.getTokenWithUser(dto.token, manager);

      if (user.thirdAuthType) {
        throw new BadRequestException(
          'Third-party login users cannot change the password',
        );
      }

      const marked = await manager
        .getRepository(PasswordResetToken)
        .update(
          { guid: record.guid, usedAt: IsNull() },
          { usedAt: new Date() },
        );
      if (marked.affected !== 1) {
        throw new UnauthorizedException(
          'Reset token has already been used or revoked',
        );
      }

      user.password = await bcrypt.hash(dto.new_password, 10);
      await manager.getRepository(User).save(user);

      await manager
        .getRepository(UserToken)
        .update({ userGuid: user.guid, isRevoked: false }, { isRevoked: true });
      await manager
        .getRepository(LoginSession)
        .delete({ userGuid: user.guid, used: false });

      this.logger.log(`Password reset completed for user ${user.username}`);

      return {
        message: 'Password has been reset successfully',
        username: user.username,
      };
    });
  }

  /**
   * Load a reset token record together with its owning user, validating the token
   */
  private async getTokenWithUser(
    token: string,
    manager?: import('typeorm').EntityManager,
  ): Promise<{ user: User; record: PasswordResetToken }> {
    const tokenRepository =
      manager?.getRepository(PasswordResetToken) ??
      this.passwordResetTokenRepository;

    const record = await tokenRepository.findOne({ where: { token } });
    if (!record) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    if (record.usedAt) {
      throw new UnauthorizedException(
        'Reset token has already been used or revoked',
      );
    }
    if (new Date() > record.expiresAt) {
      throw new UnauthorizedException('Reset token has expired');
    }

    const user = manager
      ? await manager
          .getRepository(User)
          .findOne({ where: { guid: record.userGuid } })
      : await this.authUserHelper.findByGuid(record.userGuid);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    return { user, record };
  }
}
