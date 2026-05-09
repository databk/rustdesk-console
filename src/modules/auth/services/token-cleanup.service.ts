import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { UserToken } from '../../user/entities/user-token.entity';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(
    @InjectRepository(UserToken)
    private tokenRepository: Repository<UserToken>,
  ) {}

  @Cron('0 0 * * *')
  async handleCleanupExpiredTokens() {
    try {
      const now = new Date();
      const result = await this.tokenRepository.delete({
        expiresAt: LessThan(now),
        isRevoked: true,
      });

      if (result.affected && result.affected > 0) {
        this.logger.log(
          `Cleaned up ${result.affected} expired/revoked tokens`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired tokens', error.stack);
    }
  }
}
