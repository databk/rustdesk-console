import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Patch,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from './audit.service';
import {
  ConnectionAuditDto,
  ActiveConnectionQueryDto,
  ConnectionAuditQueryDto,
  UpdateConnectionAuditDto,
} from './dto/connection-audit.dto';
import { FileAuditDto } from './dto/file-audit.dto';
import { AlarmAuditDto } from './dto/alarm-audit.dto';
import { Public } from '../auth/decorators/public.decorator';
import {
  RequirePermission,
  RequireSuperAdmin,
} from '../rbac/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * Audit controller
 * Handles audit-related HTTP requests and records connection, file transfer and alarm events
 *
 * Number of endpoints: 7
 * - POST /api/audit/conn - Record connection audit
 * - POST /api/audit/file - Record file audit
 * - POST /api/audit/alarm - Record alarm audit
 * - GET /api/audits/conn - Query connection audits
 * - GET /api/audits/file - Query file audits
 * - GET /api/audits/alarm - Query alarm audits
 * - GET /api/audits/console - Query console audits
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // ============ Audit recording endpoints (called by clients, kept public) ============

  /**
   * Record connection audit
   * Records remote desktop connection events, including connection time, both parties and connection duration
   *
   * Features:
   * - Records device information of the connection initiator and receiver
   * - Records connection start and end times
   * - Records connection type and status
   * - Supports high-frequency recording (rate limit: 50 per minute)
   *
   * Security measures:
   * - Uses the @Public decorator; devices authenticate with their own tokens
   * - Rate limiting enabled: at most 50 requests per minute
   *
   * @param dto Connection audit data transfer object
   * @returns On success, a message, the status and the audit record ID
   */
  @Public()
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @Post('conn')
  async auditConnection(@Body() dto: ConnectionAuditDto) {
    const result = await this.auditService.auditConnection(dto);
    return {
      message: 'Connection audit recorded successfully',
      status: 'success',
      data: result,
    };
  }

  /**
   * Record file audit
   * Records file transfer events, including file name, size, transfer direction and transfer status
   *
   * Features:
   * - Records the initiator and receiver of the file transfer
   * - Records basic file information (name, size, type)
   * - Records the transfer direction (upload/download)
   * - Records the transfer status and result
   * - Supports high-frequency recording (rate limit: 50 per minute)
   *
   * Security measures:
   * - Uses the @Public decorator; devices authenticate with their own tokens
   * - Rate limiting enabled: at most 50 requests per minute
   *
   * @param dto File audit data transfer object
   * @returns On success, a message, the status and the audit record ID
   */
  @Public()
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @Post('file')
  async auditFile(@Body() dto: FileAuditDto) {
    const result = await this.auditService.auditFile(dto);
    return {
      message: 'File audit recorded successfully',
      status: 'success',
      data: result,
    };
  }

  /**
   * Record alarm audit
   * Records security alarm events, including alarm type, alarm level and alarm content
   *
   * Features:
   * - Records the alarm type (e.g. abnormal login, unauthorized access)
   * - Records the alarm level (low/medium/high/critical)
   * - Records the detailed alarm content
   * - Records the alarm time and source device
   * - Supports high-frequency recording (rate limit: 50 per minute)
   *
   * Security measures:
   * - Uses the @Public decorator; devices authenticate with their own tokens
   * - Rate limiting enabled: at most 50 requests per minute
   *
   * @param dto Alarm audit data transfer object
   * @returns On success, a message, the status and the audit record ID
   */
  @Public()
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @Post('alarm')
  async auditAlarm(@Body() dto: AlarmAuditDto) {
    const result = await this.auditService.auditAlarm(dto);
    return {
      message: 'Alarm audit recorded successfully',
      status: 'success',
      data: result,
    };
  }
}

@Controller('audits')
export class AuditsController {
  constructor(private readonly auditService: AuditService) {}

  // ============ Audit query endpoints (called by the admin side, authentication required) ============

  @RequirePermission('devices.disconnect')
  @Get('conn/active')
  queryActiveConnections(
    @Query() query: ActiveConnectionQueryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.auditService.queryActiveConnections(userId, query);
  }

  /**
   * Query connection audits
   * Queries audit records of remote desktop connections
   *
   * Features:
   * - Supports paginated queries
   * - Supports filtering by controlled device ID (fuzzy match on deviceId)
   * - Supports filtering by time range (startTime/endTime range query)
   * - Supports filtering by connection type (type; -1 means no connection established)
   *
   * Security measures:
   * - Requires the audit.view permission
   * - Only administrators can query audit records
   *
   * @param deviceId Controlled device ID (fuzzy match)
   * @param type Connection type (-1 means no connection established)
   * @param startTime Start time (ISO 8601 format)
   * @param endTime End time (ISO 8601 format)
   * @param pageSize Records per page
   * @param current Current page number
   * @returns Connection audit list
   */
  @RequirePermission('audit.view')
  @Get('conn')
  async queryConnectionAudits(
    @CurrentUser('id') userId: string,
    @Query() query: ConnectionAuditQueryDto,
  ) {
    return await this.auditService.queryConnectionAudits(query, userId);
  }

  /**
   * Update connection audit record
   * Admin-side partial update of a connection audit record (e.g. add/modify/clear the note)
   *
   * @param id Primary key of the connection audit record
   * @param dto Update data
   */
  @RequireSuperAdmin()
  @Patch('conn/:id')
  async updateConnectionAudit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateConnectionAuditDto,
  ) {
    const result = await this.auditService.updateConnectionAudit(id, dto);
    return {
      message: 'Connection audit updated successfully',
      status: 'success',
      data: result,
    };
  }

  /**
   * Query file audits
   * Queries audit records of file transfers
   *
   * Features:
   * - Supports paginated queries
   * - Supports filtering by controlled device ID (fuzzy match on deviceId)
   * - Supports filtering by time range (startTime/endTime range query)
   * - Supports filtering by file transfer type (type: 0 - send, 1 - receive)
   *
   * Security measures:
   * - Requires the audit.view permission
   * - Only administrators can query audit records
   *
   * @param deviceId Controlled device ID (fuzzy match)
   * @param type File transfer type (0: SEND, 1: RECEIVE)
   * @param startTime Start time (ISO 8601 format)
   * @param endTime End time (ISO 8601 format)
   * @param pageSize Records per page
   * @param current Current page number
   * @returns File audit list
   */
  @RequirePermission('audit.view')
  @Get('file')
  async queryFileAudits(
    @Query('deviceId') deviceId?: string,
    @Query('type') type?: number,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('pageSize') pageSize?: number,
    @Query('current') current?: number,
  ) {
    return await this.auditService.queryFileAudits({
      deviceId,
      type,
      startTime,
      endTime,
      pageSize,
      current,
    });
  }

  /**
   * Query alarm audits
   * Queries audit records of security alarms
   *
   * Features:
   * - Supports paginated queries
   * - Supports filtering by controlled device ID (fuzzy match on deviceId)
   * - Supports filtering by time range (startTime/endTime range query)
   * - Supports filtering by alarm type (type: 0 - IP whitelist, 1 - more than 30 attempts, 2 - 6 attempts in 1 minute, 6 - IPv6 prefix limit exceeded, 7 - terminal OS login backoff, 8 - terminal OS login concurrency limit exceeded, 9 - session scope violation, 10 - ID whitelist violation)
   *
   * Security measures:
   * - Requires the audit.view permission
   * - Only administrators can query audit records
   *
   * @param deviceId Controlled device ID (fuzzy match)
   * @param type Alarm type
   * @param startTime Start time (ISO 8601 format)
   * @param endTime End time (ISO 8601 format)
   * @param pageSize Records per page
   * @param current Current page number
   * @returns Alarm audit list
   */
  @RequirePermission('audit.view')
  @Get('alarm')
  async queryAlarmAudits(
    @Query('deviceId') deviceId?: string,
    @Query('type') type?: number,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('pageSize') pageSize?: number,
    @Query('current') current?: number,
  ) {
    return await this.auditService.queryAlarmAudits({
      deviceId,
      type,
      startTime,
      endTime,
      pageSize,
      current,
    });
  }

  /**
   * Query console audits
   * Queries audit records of console operations
   *
   * Features:
   * - Supports paginated queries
   * - Supports filtering by operator
   * - Supports filtering by creation time
   *
   * Security measures:
   * - Requires the audit.view permission
   * - Only administrators can query audit records
   *
   * @param operator Operator (fuzzy match)
   * @param pageSize Records per page
   * @param current Current page number
   * @param start_time Start time (UTC time string)
   * @param end_time End time (UTC time string)
   * @returns Console audit list
   */
  @RequirePermission('audit.view')
  @Get('console')
  queryConsoleAudits(
    @Query('operator') operator?: string,
    @Query('action') action?: string,
    @Query('target_type') targetType?: string,
    @Query('result') result?: 'allowed' | 'denied',
    @Query('pageSize') pageSize?: number,
    @Query('current') current?: number,
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string,
  ) {
    return this.auditService.queryConsoleAudits({
      operator,
      action,
      targetType,
      result,
      pageSize,
      current,
      startTime,
      endTime,
    });
  }
}
