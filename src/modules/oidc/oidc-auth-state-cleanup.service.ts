import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import {
  OidcAuthState,
  OidcAuthStatus,
} from './entities/oidc-auth-state.entity';

@Injectable()
/**
 * OidcAuthStateCleanupService
 * 定时清理过期的OIDC授权状态记录
 *
 * 清理策略：
 * - 删除已过期的PENDING/EXPIRED/CANCELLED状态记录
 * - 删除超过1天未取走的AUTHORIZED状态记录（含明文JWT，需及时清理）
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

      // 清理已过期的PENDING/EXPIRED/CANCELLED/CONSUMED状态记录
      const expiredResult = await this.authStateRepository.delete({
        expiresAt: LessThan(now),
        status: In([
          OidcAuthStatus.PENDING,
          OidcAuthStatus.EXPIRED,
          OidcAuthStatus.CANCELLED,
          OidcAuthStatus.CONSUMED,
        ]),
      });

      // 清理超过1天未取走的AUTHORIZED状态记录（含明文JWT，需及时清理）
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
