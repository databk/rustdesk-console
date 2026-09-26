import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import {
  OidcAuthState,
  OidcAuthStatus,
} from '../entities/oidc-auth-state.entity';

@Injectable()
/**
 * OidcAuthStateCleanupService
 * Periodically cleans up expired OIDC authorization state records
 *
 * Cleanup policy:
 * - Delete expired PENDING/EXPIRED/CANCELLED state records
 * - Delete AUTHORIZED state records not retrieved within 1 day (they contain plaintext JWTs and must be cleaned up promptly)
 */
export class OidcAuthStateCleanupService {
  private readonly logger = new Logger(OidcAuthStateCleanupService.name);

  constructor(
    @InjectRepository(OidcAuthState)
    private authStateRepository: Repository<OidcAuthState>,
  ) {}

  @Cron('0 0 * * *')
  async handleCleanupExpiredAuthStates() {
    try {
      const now = new Date();

      // Clean up expired PENDING/EXPIRED/CANCELLED/CONSUMED state records
      const expiredResult = await this.authStateRepository.delete({
        expiresAt: LessThan(now),
        status: In([
          OidcAuthStatus.PENDING,
          OidcAuthStatus.EXPIRED,
          OidcAuthStatus.CANCELLED,
          OidcAuthStatus.CONSUMED,
        ]),
      });

      // Clean up AUTHORIZED state records not retrieved within 1 day (they contain plaintext JWTs and must be cleaned up promptly)
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const staleResult = await this.authStateRepository.delete({
        status: OidcAuthStatus.AUTHORIZED,
        updatedAt: LessThan(oneDayAgo),
      });

      const totalAffected =
        (expiredResult.affected ?? 0) + (staleResult.affected ?? 0);
      if (totalAffected > 0) {
        this.logger.log(
          `Cleaned up ${expiredResult.affected ?? 0} expired and ${staleResult.affected ?? 0} stale OIDC auth states`,
        );
      }
    } catch (error: unknown) {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error('Failed to cleanup OIDC auth states', stack);
    }
  }
}
