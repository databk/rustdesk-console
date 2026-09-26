import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, In, QueryFailedError } from 'typeorm';
import { ConnectionAudit, ConnType } from './entities/connection-audit.entity';
import { FileAudit } from './entities/file-audit.entity';
import { AlarmAudit } from './entities/alarm-audit.entity';
import { ConnectionAuditDto } from './dto/connection-audit.dto';
import { UpdateConnectionAuditDto } from './dto/connection-audit.dto';
import { FileAuditDto } from './dto/file-audit.dto';
import { AlarmAuditDto } from './dto/alarm-audit.dto';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { ActiveConnection } from '../heartbeat/entities/active-connection.entity';
import { Peer } from '../../common/entities/peer.entity';
import { ActiveConnectionQueryDto } from './dto/connection-audit.dto';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';

@Injectable()
/**
 * AuditService
 * Core service responsible for recording and querying audit logs
 *
 * Features:
 * - Connection audit records
 * - File transfer audit records
 * - Alarm audit records
 * - Audit log queries
 * - Audit statistics
 *
 * Architecture:
 * Handles three types of audit events: connection, file transfer and alarm
 */
export class AuditService {
  constructor(
    @InjectRepository(ConnectionAudit)
    private readonly connectionAuditRepository: Repository<ConnectionAudit>,
    @InjectRepository(FileAudit)
    private readonly fileAuditRepository: Repository<FileAudit>,
    @InjectRepository(AlarmAudit)
    private readonly alarmAuditRepository: Repository<AlarmAudit>,
    @InjectRepository(ActiveConnection)
    private readonly activeConnectionRepository: Repository<ActiveConnection>,
    @InjectRepository(Peer)
    private readonly peerRepository: Repository<Peer>,
    private readonly rbacAuditService: RbacAuditService,
    private readonly rbacAuthorizationService: RbacAuthorizationService,
  ) {}

  /**
   * Record connection audit
   * Records details of remote desktop connections, including connection establishment, disconnection and other operations
   * Also supports note-only requests (adding a remark only)
   *
   * @param dto Connection audit data
   * @returns The saved connection audit record
   */
  async auditConnection(dto: ConnectionAuditDto): Promise<ConnectionAudit> {
    // Determine whether this is a note-only request (no uuid and conn_id, but has session_id and note)
    if (!dto.uuid && dto.session_id !== undefined && dto.note !== undefined) {
      return this.addConnectionNote(dto);
    }

    return this.upsertConnectionAudit(dto);
  }

  /**
   * Add note only
   * Find the existing connection record by deviceId + sessionId and update the note
   */
  private async addConnectionNote(
    dto: ConnectionAuditDto,
  ): Promise<ConnectionAudit> {
    const sessionId = String(dto.session_id);

    const existingConnection = await this.connectionAuditRepository.findOne({
      where: {
        deviceId: dto.id,
        sessionId,
      },
    });

    if (!existingConnection) {
      throw new NotFoundException(
        `Connection audit not found for deviceId=${dto.id}, sessionId=${sessionId}`,
      );
    }

    existingConnection.note = dto.note || null;
    return await this.connectionAuditRepository.save(existingConnection);
  }

  /**
   * Admin-side update of a connection audit record
   * Find the record by primary key and update the note field
   */
  async updateConnectionAudit(
    id: number,
    dto: UpdateConnectionAuditDto,
  ): Promise<ConnectionAudit> {
    const existingConnection = await this.connectionAuditRepository.findOne({
      where: { id },
    });

    if (!existingConnection) {
      throw new NotFoundException(`Connection audit not found for id=${id}`);
    }

    existingConnection.note = dto.note || null;
    return await this.connectionAuditRepository.save(existingConnection);
  }

  /**
   * Create or update a connection audit record
   * Handle a full connection status report (including uuid)
   */
  private async upsertConnectionAudit(
    dto: ConnectionAuditDto,
  ): Promise<ConnectionAudit> {
    const connId = dto.conn_id !== undefined ? String(dto.conn_id) : null;
    const sessionId =
      dto.session_id !== undefined ? String(dto.session_id) : null;

    // Convert the action status
    let action: string;
    if (dto.action === 'new') {
      action = 'open';
    } else if (dto.action === '' || !dto.action) {
      action = 'established';
    } else {
      action = dto.action;
    }

    // Try to find an existing connection (same deviceId, deviceUuid and connId are treated as the same connection)
    const whereCondition: FindOptionsWhere<ConnectionAudit> = {
      deviceId: dto.id,
      deviceUuid: dto.uuid,
    };
    if (connId !== null) {
      whereCondition.connId = connId;
    }

    const existingConnection = await this.connectionAuditRepository.findOne({
      where: whereCondition,
    });

    if (existingConnection) {
      return this.updateExistingConnection(
        existingConnection,
        dto,
        action,
        sessionId,
      );
    }

    return this.createNewConnection(dto, action, connId, sessionId);
  }

  /**
   * Update an existing connection audit record
   */
  private async updateExistingConnection(
    existingConnection: ConnectionAudit,
    dto: ConnectionAuditDto,
    action: string,
    sessionId: string | null,
  ): Promise<ConnectionAudit> {
    if (action === 'open' && !existingConnection.requestedAt) {
      existingConnection.requestedAt = new Date();
    }
    if (action === 'established' && !existingConnection.establishedAt) {
      existingConnection.establishedAt = new Date();
    }
    if (action === 'close' && !existingConnection.closedAt) {
      existingConnection.closedAt = new Date();
    }
    if (sessionId !== null && sessionId !== existingConnection.sessionId) {
      existingConnection.sessionId = sessionId;
    }
    if (dto.ip && dto.ip !== existingConnection.ip) {
      existingConnection.ip = dto.ip;
    }
    if (dto.peer && dto.peer[0] !== existingConnection.peerId) {
      existingConnection.peerId = dto.peer[0];
    }
    if (dto.peer && dto.peer[1] !== existingConnection.peerName) {
      existingConnection.peerName = dto.peer[1];
    }
    if (dto.type !== undefined && dto.type !== existingConnection.type) {
      existingConnection.type = dto.type;
    }
    if (
      dto.conn_audit_ref !== undefined &&
      dto.conn_audit_ref !== existingConnection.connAuditRef
    ) {
      existingConnection.connAuditRef = dto.conn_audit_ref || null;
    }
    if (
      dto.primary_auth !== undefined &&
      dto.primary_auth !== existingConnection.primaryAuth
    ) {
      existingConnection.primaryAuth = dto.primary_auth;
    }
    if (
      dto.two_factor !== undefined &&
      dto.two_factor !== existingConnection.twoFactor
    ) {
      existingConnection.twoFactor = dto.two_factor;
    }
    if (dto.nonce && dto.nonce !== existingConnection.nonce) {
      existingConnection.nonce = dto.nonce;
    }
    existingConnection.action = action;
    return await this.connectionAuditRepository.save(existingConnection);
  }

  /**
   * Create a new connection audit record
   */
  private async createNewConnection(
    dto: ConnectionAuditDto,
    action: string,
    connId: string | null,
    sessionId: string | null,
  ): Promise<ConnectionAudit> {
    const connectionAudit = this.connectionAuditRepository.create({
      deviceId: dto.id,
      deviceUuid: dto.uuid,
      connId,
      sessionId,
      ip: dto.ip || '',
      action,
      peerId: dto.peer ? dto.peer[0] : null,
      peerName: dto.peer ? dto.peer[1] : null,
      type: dto.type !== undefined ? dto.type : ConnType.NOT_ESTABLISHED,
      requestedAt: action === 'open' ? new Date() : null,
      establishedAt: action === 'established' ? new Date() : null,
      closedAt: action === 'close' ? new Date() : null,
      nonce: dto.nonce || null,
      connAuditRef: dto.conn_audit_ref || null,
      primaryAuth: dto.primary_auth ?? null,
      twoFactor: dto.two_factor ?? null,
    });

    return await this.connectionAuditRepository.save(connectionAudit);
  }

  /**
   * Record file audit
   * Records details of file transfer operations
   *
   * @param dto File audit data
   * @returns The saved file audit record
   */
  async auditFile(dto: FileAuditDto): Promise<FileAudit> {
    // nonce deduplication: look up existing records first (with deviceId to prevent cross-device mismatches)
    if (dto.nonce) {
      const existing = await this.fileAuditRepository.findOne({
        where: { deviceId: dto.id, nonce: dto.nonce },
      });
      if (existing) {
        return existing;
      }
    }

    // Parse the info JSON string
    let info: {
      ip: string;
      name: string;
      num: number;
      files: Array<[string, number]>;
    };
    try {
      info = JSON.parse(dto.info) as typeof info;
    } catch {
      info = { ip: '', name: '', num: 0, files: [] };
    }

    const fileAudit = this.fileAuditRepository.create({
      deviceId: dto.id,
      deviceUuid: dto.uuid,
      peerId: dto.peer_id || '',
      connId: dto.conn_id != null ? String(dto.conn_id) : null,
      type: dto.type !== undefined ? dto.type : 0,
      path: dto.path || null,
      isFile: dto.is_file || false,
      clientIp: info.ip || '',
      clientName: info.name || '',
      fileCount: info.num || 0,
      files: info.files?.slice(0, 10) || [],
      nonce: dto.nonce || null,
    });

    try {
      return await this.fileAuditRepository.save(fileAudit);
    } catch (err) {
      // Unique index conflict under concurrency; re-query and return the existing record
      if (dto.nonce && this.isUniqueConstraintError(err)) {
        const existing = await this.fileAuditRepository.findOne({
          where: { deviceId: dto.id, nonce: dto.nonce },
        });
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Record alarm audit
   * Records details of security alarms
   *
   * @param dto Alarm audit data
   * @returns The saved alarm audit record
   */
  async auditAlarm(dto: AlarmAuditDto): Promise<AlarmAudit> {
    // nonce deduplication: look up existing records first (with deviceId to prevent cross-device mismatches)
    if (dto.nonce) {
      const existing = await this.alarmAuditRepository.findOne({
        where: { deviceId: dto.id, nonce: dto.nonce },
      });
      if (existing) {
        return existing;
      }
    }

    // Parse the info JSON string
    let info: { id?: string; ip: string; name?: string };
    try {
      info = JSON.parse(dto.info) as typeof info;
    } catch {
      info = { ip: '' };
    }

    const alarmAudit = this.alarmAuditRepository.create({
      deviceId: dto.id,
      deviceUuid: dto.uuid,
      typ: dto.typ,
      infoId: info.id || null,
      infoIp: info.ip || '',
      infoName: info.name || null,
      connId: dto.conn_id != null ? String(dto.conn_id) : null,
      nonce: dto.nonce || null,
      connAuditRef: dto.conn_audit_ref || null,
    });

    try {
      return await this.alarmAuditRepository.save(alarmAudit);
    } catch (err) {
      // Unique index conflict under concurrency; re-query and return the existing record
      if (dto.nonce && this.isUniqueConstraintError(err)) {
        const existing = await this.alarmAuditRepository.findOne({
          where: { deviceId: dto.id, nonce: dto.nonce },
        });
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Query connection audits
   * @param filters Filter conditions
   * @returns Connection audit list
   */
  async queryConnectionAudits(
    filters: {
      deviceId?: string;
      type?: number;
      startTime?: string;
      endTime?: string;
      pageSize?: number;
      current?: number;
    },
    actorGuid: string,
  ) {
    const {
      deviceId,
      type,
      startTime,
      endTime,
      pageSize = 10,
      current = 1,
    } = filters;
    const skip = (current - 1) * pageSize;

    const queryBuilder = this.connectionAuditRepository
      .createQueryBuilder('ca')
      .select([
        'ca.id',
        'ca.deviceId',
        'ca.deviceUuid',
        'ca.connId',
        'ca.sessionId',
        'ca.ip',
        'ca.action',
        'ca.peerId',
        'ca.peerName',
        'ca.type',
        'ca.note',
        'ca.requestedAt',
        'ca.establishedAt',
        'ca.closedAt',
        'ca.connAuditRef',
        'ca.primaryAuth',
        'ca.twoFactor',
        'ca.createdAt',
      ]);

    // Filter by controlled device ID (fuzzy match)
    if (deviceId) {
      queryBuilder.andWhere('ca.deviceId LIKE :deviceId', {
        deviceId: `%${deviceId}%`,
      });
    }

    // Filter by connection type (-1 means no connection established)
    if (type !== undefined) {
      queryBuilder.andWhere('ca.type = :type', { type });
    }

    // Filter by time range
    if (startTime) {
      const start = new Date(startTime);
      queryBuilder.andWhere('ca.createdAt >= :startTime', { startTime: start });
    }
    if (endTime) {
      const end = new Date(endTime);
      queryBuilder.andWhere('ca.createdAt <= :endTime', { endTime: end });
    }

    queryBuilder.orderBy('ca.createdAt', 'DESC').skip(skip).take(pageSize);

    const [data, total] = await queryBuilder.getManyAndCount();

    const disconnectable = await this.getDisconnectableConnectionKeys(
      actorGuid,
      data,
    );

    return {
      data: data.map((connection) => ({
        ...connection,
        can_disconnect:
          connection.connId !== null &&
          connection.closedAt === null &&
          disconnectable.has(
            this.connectionKey(connection.deviceUuid, connection.connId),
          ),
      })),
      total,
    };
  }

  async queryActiveConnections(
    actorGuid: string,
    query: ActiveConnectionQueryDto,
  ) {
    const { current = 1, pageSize = 20, deviceId } = query;
    const scope = await this.rbacAuthorizationService.requirePermission(
      actorGuid,
      'devices.disconnect',
    );
    const queryBuilder = this.activeConnectionRepository
      .createQueryBuilder('activeConnection')
      .innerJoin(Peer, 'peer', 'peer.uuid = activeConnection.deviceUuid');

    if (!scope.global) {
      if (scope.deviceGroupGuids.size) {
        queryBuilder.andWhere(
          'peer.deviceGroupGuid IN (:...deviceGroupGuids)',
          { deviceGroupGuids: [...scope.deviceGroupGuids] },
        );
      } else {
        queryBuilder.andWhere('1 = 0');
      }
    }
    const trimmedDeviceId = deviceId?.trim();
    if (trimmedDeviceId) {
      queryBuilder.andWhere('peer.id LIKE :deviceId', {
        deviceId: `%${trimmedDeviceId}%`,
      });
    }

    const total = await queryBuilder.getCount();
    const rows = await queryBuilder
      .select('activeConnection.deviceUuid', 'deviceUuid')
      .addSelect('activeConnection.connId', 'connId')
      .addSelect('peer.id', 'deviceId')
      .orderBy('peer.id', 'ASC')
      .addOrderBy('activeConnection.connId', 'ASC')
      .offset((current - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<{
        deviceId: string;
        deviceUuid: string;
        connId: string | number;
      }>();

    return {
      data: rows.map((row) => ({
        deviceId: row.deviceId,
        deviceUuid: row.deviceUuid,
        connId: Number(row.connId),
        can_disconnect: true as const,
      })),
      total,
    };
  }

  private async getDisconnectableConnectionKeys(
    actorGuid: string,
    connections: ConnectionAudit[],
  ): Promise<Set<string>> {
    const deviceUuids = [
      ...new Set(connections.map(({ deviceUuid }) => deviceUuid)),
    ];
    if (deviceUuids.length === 0) return new Set();

    const scope = await this.rbacAuthorizationService.getPermissionScope(
      actorGuid,
      'devices.disconnect',
    );
    if (!scope.global && scope.deviceGroupGuids.size === 0) return new Set();

    const peers = await this.peerRepository.find({
      where: {
        uuid: In(deviceUuids),
        ...(scope.global
          ? {}
          : { deviceGroupGuid: In([...scope.deviceGroupGuids]) }),
      },
      select: ['uuid'],
    });
    if (peers.length === 0) return new Set();

    const activeConnections = await this.activeConnectionRepository.find({
      where: { deviceUuid: In(peers.map(({ uuid }) => uuid)) },
      select: ['deviceUuid', 'connId'],
    });
    return new Set(
      activeConnections.map(({ deviceUuid, connId }) =>
        this.connectionKey(deviceUuid, connId),
      ),
    );
  }

  private connectionKey(deviceUuid: string, connId: string | number): string {
    return `${deviceUuid}:${String(connId)}`;
  }

  /**
   * Query file audits
   * @param filters Filter conditions
   * @returns File audit list
   */
  async queryFileAudits(filters: {
    deviceId?: string;
    type?: number;
    startTime?: string;
    endTime?: string;
    pageSize?: number;
    current?: number;
  }) {
    const {
      deviceId,
      type,
      startTime,
      endTime,
      pageSize = 10,
      current = 1,
    } = filters;
    const skip = (current - 1) * pageSize;

    const queryBuilder = this.fileAuditRepository
      .createQueryBuilder('fa')
      .select([
        'fa.id',
        'fa.deviceId',
        'fa.deviceUuid',
        'fa.peerId',
        'fa.connId',
        'fa.type',
        'fa.path',
        'fa.isFile',
        'fa.clientIp',
        'fa.clientName',
        'fa.fileCount',
        'fa.files',
        'fa.createdAt',
      ]);

    // Filter by controlled device ID (fuzzy match)
    if (deviceId) {
      queryBuilder.andWhere('fa.deviceId LIKE :deviceId', {
        deviceId: `%${deviceId}%`,
      });
    }

    // Filter by file transfer type
    if (type !== undefined) {
      queryBuilder.andWhere('fa.type = :type', { type });
    }

    // Filter by time range
    if (startTime) {
      const start = new Date(startTime);
      queryBuilder.andWhere('fa.createdAt >= :startTime', { startTime: start });
    }
    if (endTime) {
      const end = new Date(endTime);
      queryBuilder.andWhere('fa.createdAt <= :endTime', { endTime: end });
    }

    queryBuilder.orderBy('fa.createdAt', 'DESC').skip(skip).take(pageSize);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
    };
  }

  /**
   * Query alarm audits
   * @param filters Filter conditions
   * @returns Alarm audit list
   */
  async queryAlarmAudits(filters: {
    deviceId?: string;
    type?: number;
    startTime?: string;
    endTime?: string;
    pageSize?: number;
    current?: number;
  }) {
    const {
      deviceId,
      type,
      startTime,
      endTime,
      pageSize = 10,
      current = 1,
    } = filters;
    const skip = (current - 1) * pageSize;

    const queryBuilder = this.alarmAuditRepository
      .createQueryBuilder('aa')
      .select([
        'aa.id',
        'aa.deviceId',
        'aa.deviceUuid',
        'aa.typ',
        'aa.infoId',
        'aa.infoIp',
        'aa.infoName',
        'aa.connId',
        'aa.connAuditRef',
        'aa.createdAt',
      ]);

    // Filter by device ID (fuzzy match)
    if (deviceId) {
      queryBuilder.andWhere('aa.deviceId LIKE :deviceId', {
        deviceId: `%${deviceId}%`,
      });
    }

    // Filter by alarm type
    if (type !== undefined) {
      queryBuilder.andWhere('aa.typ = :type', { type });
    }

    // Filter by time range
    if (startTime) {
      const start = new Date(startTime);
      queryBuilder.andWhere('aa.createdAt >= :startTime', { startTime: start });
    }
    if (endTime) {
      const end = new Date(endTime);
      queryBuilder.andWhere('aa.createdAt <= :endTime', { endTime: end });
    }

    queryBuilder.orderBy('aa.createdAt', 'DESC').skip(skip).take(pageSize);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
    };
  }

  /**
   * Query console audits
   * @param filters Filter conditions
   * @returns Console audit list
   */
  queryConsoleAudits(filters: {
    operator?: string;
    action?: string;
    targetType?: string;
    result?: 'allowed' | 'denied';
    pageSize?: number;
    current?: number;
    startTime?: string;
    endTime?: string;
  }) {
    return this.rbacAuditService.query(filters);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    // SQLite: "UNIQUE constraint failed: ..."
    if (error.message.toUpperCase().includes('UNIQUE')) {
      return true;
    }
    const driverError = error as QueryFailedError & {
      code?: string;
      errno?: number;
    };
    // MySQL: ER_DUP_ENTRY (errno 1062)
    if (driverError.code === 'ER_DUP_ENTRY' || driverError.errno === 1062) {
      return true;
    }
    // PostgreSQL: unique_violation (SQLSTATE 23505)
    if (driverError.code === '23505') {
      return true;
    }
    return false;
  }
}
