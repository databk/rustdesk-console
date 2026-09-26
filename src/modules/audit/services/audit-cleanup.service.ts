import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConnectionAudit } from '../entities/connection-audit.entity';
import { FileAudit } from '../entities/file-audit.entity';
import { AlarmAudit } from '../entities/alarm-audit.entity';
import { ConsoleAudit } from '../../rbac/entities/console-audit.entity';
import { GeneralSettingsService } from '../../settings/services/general-settings.service';

/**
 * Automatic audit log cleanup service
 * Automatically cleans up expired audit logs at midnight every day based on the retention days
 * No cleanup is performed when the retention days is 0
 */
@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(
    @InjectRepository(ConnectionAudit)
    private connectionAuditRepository: Repository<ConnectionAudit>,
    @InjectRepository(FileAudit)
    private fileAuditRepository: Repository<FileAudit>,
    @InjectRepository(AlarmAudit)
    private alarmAuditRepository: Repository<AlarmAudit>,
    @InjectRepository(ConsoleAudit)
    private consoleAuditRepository: Repository<ConsoleAudit>,
    private readonly generalSettingsService: GeneralSettingsService,
  ) {}

  @Cron('0 0 * * *')
  async handleCleanupExpiredAudits() {
    try {
      const retentionDays =
        await this.generalSettingsService.getAuditRetentionDays();

      if (retentionDays <= 0) {
        return;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      let totalDeleted = 0;

      const connectionResult = await this.connectionAuditRepository.delete({
        createdAt: LessThan(cutoffDate),
      });
      totalDeleted += connectionResult.affected || 0;

      const fileResult = await this.fileAuditRepository.delete({
        createdAt: LessThan(cutoffDate),
      });
      totalDeleted += fileResult.affected || 0;

      const alarmResult = await this.alarmAuditRepository.delete({
        createdAt: LessThan(cutoffDate),
      });
      totalDeleted += alarmResult.affected || 0;

      const consoleResult = await this.consoleAuditRepository.delete({
        createdAt: LessThan(cutoffDate),
      });
      totalDeleted += consoleResult.affected || 0;

      if (totalDeleted > 0) {
        this.logger.log(
          `Cleaned up ${totalDeleted} audit records older than ${retentionDays} days ` +
            `(connection: ${connectionResult.affected || 0}, file: ${fileResult.affected || 0}, alarm: ${alarmResult.affected || 0}, console: ${consoleResult.affected || 0})`,
        );
      }
    } catch (error: unknown) {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error('Failed to cleanup expired audit logs', stack);
    }
  }
}
