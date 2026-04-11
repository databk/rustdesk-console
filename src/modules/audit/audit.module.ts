import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController, AuditsController } from './audit.controller';
import { AuditService } from './audit.service';
import { ConnectionAudit } from './entities/connection-audit.entity';
import { FileAudit } from './entities/file-audit.entity';
import { AlarmAudit } from './entities/alarm-audit.entity';

/**
 * 审计模块
 * 负责连接、文件传输和告警事件的审计记录
 *
 * 导入模块：
 * - TypeOrmModule
 *
 * 导出服务：
 * - AuditService
 *
 * 提供服务：
 * - AuditService
 */
@Module({
  imports: [TypeOrmModule.forFeature([ConnectionAudit, FileAudit, AlarmAudit])],
  controllers: [AuditController, AuditsController],
  providers: [AuditService],
})
export class AuditModule {}
