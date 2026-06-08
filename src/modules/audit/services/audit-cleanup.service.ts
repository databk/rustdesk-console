import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConnectionAudit } from '../entities/connection-audit.entity';
import { FileAudit } from '../entities/file-audit.entity';
import { AlarmAudit } from '../entities/alarm-audit.entity';
import { AuditSettingsService } from '../../settings/services/audit-settings.service';

/**
 * 审计日志自动清理服务
 * 每天零点根据保留天数自动清理过期的审计日志
 * 保留天数为 0 时不执行清理
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
    private readonly auditSettingsService: AuditSettingsService,
  ) {}

  @Cron('0 0 * * *')
  async handleCleanupExpiredAudits() {
    try {
      const retentionDays =
        await this.auditSettingsService.getRetentionDays();

      if (retentionDays <= 0) {
        return;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      let totalDeleted = 0;

      const connectionResult =
        await this.connectionAuditRepository.delete({
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

      if (totalDeleted > 0) {
        this.logger.log(
          `Cleaned up ${totalDeleted} audit records older than ${retentionDays} days ` +
            `(connection: ${connectionResult.affected || 0}, file: ${fileResult.affected || 0}, alarm: ${alarmResult.affected || 0})`,
        );
      }
    } catch (error: unknown) {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error('Failed to cleanup expired audit logs', stack);
    }
  }
}
