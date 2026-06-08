import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController, AuditsController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditCleanupService } from './services/audit-cleanup.service';
import { ConnectionAudit } from './entities/connection-audit.entity';
import { FileAudit } from './entities/file-audit.entity';
import { AlarmAudit } from './entities/alarm-audit.entity';
import { SettingsModule } from '../settings/settings.module';

/**
 * 审计模块
 * 负责连接、文件传输和告警事件的审计记录
 *
 * 导入模块：
 * - TypeOrmModule
 * - SettingsModule（审计保留配置）
 *
 * 导出服务：
 * - AuditService
 *
 * 提供服务：
 * - AuditService
 * - AuditCleanupService（定时清理过期审计日志）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectionAudit, FileAudit, AlarmAudit]),
    SettingsModule,
  ],
  controllers: [AuditController, AuditsController],
  providers: [AuditService, AuditCleanupService],
})
export class AuditModule {}
