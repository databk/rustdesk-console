import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { ConnectionAudit } from './entities/connection-audit.entity';
import { FileAudit } from './entities/file-audit.entity';
import { AlarmAudit } from './entities/alarm-audit.entity';
import { ConnectionAuditDto } from './dto/connection-audit.dto';
import { FileAuditDto } from './dto/file-audit.dto';
import { AlarmAuditDto } from './dto/alarm-audit.dto';

@Injectable()
/**
 * AuditService
 * 负责审计日志记录和查询的核心服务
 *
 * 功能：
 * - 连接审计记录
 * - 文件传输审计记录
 * - 告警审计记录
 * - 审计日志查询
 * - 审计统计
 *
 * 架构说明：
 * 处理三种类型的审计事件：连接、文件传输和告警
 */
export class AuditService {
  constructor(
    @InjectRepository(ConnectionAudit)
    private readonly connectionAuditRepository: Repository<ConnectionAudit>,
    @InjectRepository(FileAudit)
    private readonly fileAuditRepository: Repository<FileAudit>,
    @InjectRepository(AlarmAudit)
    private readonly alarmAuditRepository: Repository<AlarmAudit>,
  ) {}

  /**
   * 记录连接审计
   * 记录远程桌面连接的详细信息，包括连接建立、断开等操作
   * 也支持仅添加备注（note-only）的请求
   *
   * @param dto 连接审计数据
   * @returns 保存的连接审计记录
   */
  async auditConnection(dto: ConnectionAuditDto): Promise<ConnectionAudit> {
    // 判断是否为仅添加备注的请求（无 uuid 和 conn_id，有 session_id 和 note）
    if (!dto.uuid && dto.session_id !== undefined && dto.note !== undefined) {
      return this.addConnectionNote(dto);
    }

    return this.upsertConnectionAudit(dto);
  }

  /**
   * 仅添加备注
   * 通过 deviceId + sessionId 查找已有连接记录并更新备注
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
   * 创建或更新连接审计记录
   * 处理完整的连接状态上报（含 uuid）
   */
  private async upsertConnectionAudit(
    dto: ConnectionAuditDto,
  ): Promise<ConnectionAudit> {
    const connId = dto.conn_id !== undefined ? String(dto.conn_id) : null;
    const sessionId =
      dto.session_id !== undefined ? String(dto.session_id) : null;

    // 转换 action 状态
    let action: string;
    if (dto.action === 'new') {
      action = 'open';
    } else if (dto.action === '' || !dto.action) {
      action = 'established';
    } else {
      action = dto.action;
    }

    // 尝试查找现有连接（deviceId、deviceUuid、connId 均相同视为同一连接）
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
   * 更新已有连接审计记录
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
    // 有值则覆盖，无值保留原值
    if (dto.note !== undefined && dto.note !== '') {
      existingConnection.note = dto.note;
    }
    existingConnection.action = action;
    return await this.connectionAuditRepository.save(existingConnection);
  }

  /**
   * 创建新连接审计记录
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
      type: dto.type !== undefined ? dto.type : null,
      note: dto.note || null,
      requestedAt: action === 'open' ? new Date() : null,
      establishedAt: action === 'established' ? new Date() : null,
      closedAt: action === 'close' ? new Date() : null,
    });

    return await this.connectionAuditRepository.save(connectionAudit);
  }

  /**
   * 记录文件审计
   * 记录文件传输操作的详细信息
   *
   * @param dto 文件审计数据
   * @returns 保存的文件审计记录
   */
  async auditFile(dto: FileAuditDto): Promise<FileAudit> {
    // 解析 info JSON 字符串
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
      type: dto.type !== undefined ? dto.type : 0,
      path: dto.path || null,
      isFile: dto.is_file || false,
      clientIp: info.ip || '',
      clientName: info.name || '',
      fileCount: info.num || 0,
      files: info.files?.slice(0, 10) || [],
    });

    return await this.fileAuditRepository.save(fileAudit);
  }

  /**
   * 记录告警审计
   * 记录安全告警的详细信息
   *
   * @param dto 告警审计数据
   * @returns 保存的告警审计记录
   */
  async auditAlarm(dto: AlarmAuditDto): Promise<AlarmAudit> {
    // 解析 info JSON 字符串
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
    });

    return await this.alarmAuditRepository.save(alarmAudit);
  }

  /**
   * 查询连接审计
   * @param filters 过滤条件
   * @returns 连接审计列表
   */
  async queryConnectionAudits(filters: {
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

    const queryBuilder = this.connectionAuditRepository
      .createQueryBuilder('ca')
      .select([
        'ca.id',
        'ca.deviceId',
        'ca.deviceUuid',
        'ca.connId',
        'ca.ip',
        'ca.action',
        'ca.peerId',
        'ca.peerName',
        'ca.type',
        'ca.note',
        'ca.requestedAt',
        'ca.establishedAt',
        'ca.closedAt',
        'ca.createdAt',
      ]);

    // 按被控端设备ID过滤（模糊匹配）
    if (deviceId) {
      queryBuilder.andWhere('ca.deviceId LIKE :deviceId', {
        deviceId: `%${deviceId}%`,
      });
    }

    // 按连接类型过滤
    if (type !== undefined) {
      queryBuilder.andWhere('ca.type = :type', { type });
    }

    // 按时间段过滤
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

    return {
      data,
      total,
    };
  }

  /**
   * 查询文件审计
   * @param filters 过滤条件
   * @returns 文件审计列表
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
        'fa.type',
        'fa.path',
        'fa.isFile',
        'fa.clientIp',
        'fa.clientName',
        'fa.fileCount',
        'fa.files',
        'fa.createdAt',
      ]);

    // 按被控端设备ID过滤（模糊匹配）
    if (deviceId) {
      queryBuilder.andWhere('fa.deviceId LIKE :deviceId', {
        deviceId: `%${deviceId}%`,
      });
    }

    // 按文件传输类型过滤
    if (type !== undefined) {
      queryBuilder.andWhere('fa.type = :type', { type });
    }

    // 按时间段过滤
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
   * 查询告警审计
   * @param filters 过滤条件
   * @returns 告警审计列表
   */
  async queryAlarmAudits(filters: {
    device?: string;
    pageSize?: number;
    current?: number;
    created_at?: string;
  }) {
    const { device, pageSize = 10, current = 1, created_at } = filters;
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
        'aa.createdAt',
      ]);

    // 按设备ID过滤
    if (device) {
      queryBuilder.andWhere('aa.deviceId LIKE :device', {
        device: `%${device}%`,
      });
    }

    // 按创建时间过滤
    if (created_at) {
      const createdAt = new Date(created_at);
      queryBuilder.andWhere('aa.createdAt >= :createdAt', { createdAt });
    }

    queryBuilder.orderBy('aa.createdAt', 'DESC').skip(skip).take(pageSize);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
    };
  }

  /**
   * 查询控制台审计
   * @param filters 过滤条件
   * @returns 控制台审计列表
   */
  queryConsoleAudits(_filters: {
    operator?: string;
    pageSize?: number;
    current?: number;
    created_at?: string;
  }) {
    // 控制台审计暂时没有实体，返回空列表
    return {
      data: [],
      total: 0,
    };
  }
}
