import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController, AuditsController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditCleanupService } from './services/audit-cleanup.service';
import { ConnectionAudit } from './entities/connection-audit.entity';
import { FileAudit } from './entities/file-audit.entity';
import { AlarmAudit } from './entities/alarm-audit.entity';
import { SettingsModule } from '../settings/settings.module';
import { RbacModule } from '../rbac/rbac.module';
import { ActiveConnection } from '../heartbeat/entities/active-connection.entity';
import { Peer } from '../../common/entities/peer.entity';
import { ConsoleAudit } from '../rbac/entities/console-audit.entity';

/**
 * Audit module
 * Responsible for auditing connection, file transfer and alarm events
 *
 * Imported modules:
 * - TypeOrmModule
 * - SettingsModule (audit retention settings)
 *
 * Exported services:
 * - AuditService
 *
 * Provided services:
 * - AuditService
 * - AuditCleanupService (scheduled cleanup of expired audit logs)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConnectionAudit,
      FileAudit,
      AlarmAudit,
      ConsoleAudit,
      ActiveConnection,
      Peer,
    ]),
    SettingsModule,
    RbacModule,
  ],
  controllers: [AuditController, AuditsController],
  providers: [AuditService, AuditCleanupService],
})
export class AuditModule {}
