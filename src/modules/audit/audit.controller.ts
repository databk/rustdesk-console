import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from './audit.service';
import { ConnectionAuditDto } from './dto/connection-audit.dto';
import { FileAuditDto } from './dto/file-audit.dto';
import { AlarmAuditDto } from './dto/alarm-audit.dto';
import { Public } from '../auth/decorators/public.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * 审计控制器
 * 负责处理审计相关的HTTP请求，记录连接、文件传输和告警事件
 *
 * 端点数量：7个
 * - POST /api/audit/conn - 记录连接审计
 * - POST /api/audit/file - 记录文件审计
 * - POST /api/audit/alarm - 记录告警审计
 * - GET /api/audits/conn - 查询连接审计
 * - GET /api/audits/file - 查询文件审计
 * - GET /api/audits/alarm - 查询告警审计
 * - GET /api/audits/console - 查询控制台审计
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // ============ 审计记录接口（客户端调用，保持公开）============

  /**
   * 记录连接审计
   * 记录远程桌面连接事件，包括连接时间、连接双方、连接时长等信息
   *
   * 功能说明：
   * - 记录连接发起方和接收方的设备信息
   * - 记录连接开始和结束时间
   * - 记录连接类型和状态
   * - 支持高频率记录（限流：每分钟50次）
   *
   * 安全措施：
   * - 使用@Public装饰器，设备使用自己的令牌进行认证
   * - 启用限流保护：每分钟最多50次请求
   *
   * @param dto 连接审计数据传输对象
   * @returns 记录成功返回消息、状态和审计记录ID
   */
  @Public()
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @Post('conn')
  async auditConnection(@Body() dto: ConnectionAuditDto) {
    const result = await this.auditService.auditConnection(dto);
    return {
      message: '连接审计记录成功',
      status: 'success',
      data: result,
    };
  }

  /**
   * 记录文件审计
   * 记录文件传输事件，包括文件名称、大小、传输方向、传输状态等信息
   *
   * 功能说明：
   * - 记录文件传输的发起方和接收方
   * - 记录文件的基本信息（名称、大小、类型）
   * - 记录传输方向（上传/下载）
   * - 记录传输状态和结果
   * - 支持高频率记录（限流：每分钟50次）
   *
   * 安全措施：
   * - 使用@Public装饰器，设备使用自己的令牌进行认证
   * - 启用限流保护：每分钟最多50次请求
   *
   * @param dto 文件审计数据传输对象
   * @returns 记录成功返回消息、状态和审计记录ID
   */
  @Public()
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @Post('file')
  async auditFile(@Body() dto: FileAuditDto) {
    const result = await this.auditService.auditFile(dto);
    return {
      message: '文件审计记录成功',
      status: 'success',
      data: result,
    };
  }

  /**
   * 记录告警审计
   * 记录安全告警事件，包括告警类型、告警级别、告警内容等信息
   *
   * 功能说明：
   * - 记录告警的类型（如异常登录、未授权访问等）
   * - 记录告警的级别（低/中/高/严重）
   * - 记录告警的详细内容
   * - 记录告警的时间和来源设备
   * - 支持高频率记录（限流：每分钟50次）
   *
   * 安全措施：
   * - 使用@Public装饰器，设备使用自己的令牌进行认证
   * - 启用限流保护：每分钟最多50次请求
   *
   * @param dto 告警审计数据传输对象
   * @returns 记录成功返回消息、状态和审计记录ID
   */
  @Public()
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @Post('alarm')
  async auditAlarm(@Body() dto: AlarmAuditDto) {
    const result = await this.auditService.auditAlarm(dto);
    return {
      message: '告警审计记录成功',
      status: 'success',
      data: result,
    };
  }
}

@Controller('audits')
export class AuditsController {
  constructor(private readonly auditService: AuditService) {}

  // ============ 审计查询接口（管理端调用，需要认证）============

  /**
   * 查询连接审计
   * 查询远程桌面连接的审计记录
   *
   * 功能说明：
   * - 支持分页查询
   * - 支持按远程设备ID过滤
   * - 支持按连接类型过滤
   * - 支持按创建时间过滤
   *
   * 安全措施：
   * - 使用AdminGuard进行认证
   * - 只有管理员可以查询审计记录
   *
   * @param remote 远程设备ID（模糊匹配）
   * @param conn_type 连接类型
   * @param pageSize 每页记录数
   * @param current 当前页码
   * @param created_at 创建时间（UTC时间字符串）
   * @returns 连接审计列表
   */
  @UseGuards(AdminGuard)
  @Get('conn')
  async queryConnectionAudits(
    @Query('remote') remote?: string,
    @Query('conn_type') conn_type?: number,
    @Query('pageSize') pageSize?: number,
    @Query('current') current?: number,
    @Query('created_at') created_at?: string,
  ) {
    return await this.auditService.queryConnectionAudits({
      remote,
      conn_type,
      pageSize,
      current,
      created_at,
    });
  }

  /**
   * 查询文件审计
   * 查询文件传输的审计记录
   *
   * 功能说明：
   * - 支持分页查询
   * - 支持按对端设备ID过滤（peerId模糊匹配）
   * - 支持按时间段过滤（startTime/endTime范围查询）
   * - 支持按文件传输类型过滤（type: 0-发送, 1-接收）
   *
   * 安全措施：
   * - 使用AdminGuard进行认证
   * - 只有管理员可以查询审计记录
   *
   * @param peerId 对端设备ID（模糊匹配）
   * @param type 文件传输类型（0: SEND, 1: RECEIVE）
   * @param startTime 开始时间（ISO 8601格式）
   * @param endTime 结束时间（ISO 8601格式）
   * @param pageSize 每页记录数
   * @param current 当前页码
   * @returns 文件审计列表
   */
  @UseGuards(AdminGuard)
  @Get('file')
  async queryFileAudits(
    @Query('peerId') peerId?: string,
    @Query('type') type?: number,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('pageSize') pageSize?: number,
    @Query('current') current?: number,
  ) {
    return await this.auditService.queryFileAudits({
      peerId,
      type,
      startTime,
      endTime,
      pageSize,
      current,
    });
  }

  /**
   * 查询告警审计
   * 查询安全告警的审计记录
   *
   * 功能说明：
   * - 支持分页查询
   * - 支持按设备ID过滤
   * - 支持按创建时间过滤
   *
   * 安全措施：
   * - 使用AdminGuard进行认证
   * - 只有管理员可以查询审计记录
   *
   * @param device 设备ID（模糊匹配）
   * @param pageSize 每页记录数
   * @param current 当前页码
   * @param created_at 创建时间（UTC时间字符串）
   * @returns 告警审计列表
   */
  @UseGuards(AdminGuard)
  @Get('alarm')
  async queryAlarmAudits(
    @Query('device') device?: string,
    @Query('pageSize') pageSize?: number,
    @Query('current') current?: number,
    @Query('created_at') created_at?: string,
  ) {
    return await this.auditService.queryAlarmAudits({
      device,
      pageSize,
      current,
      created_at,
    });
  }

  /**
   * 查询控制台审计
   * 查询控制台操作的审计记录
   *
   * 功能说明：
   * - 支持分页查询
   * - 支持按操作人过滤
   * - 支持按创建时间过滤
   *
   * 安全措施：
   * - 使用AdminGuard进行认证
   * - 只有管理员可以查询审计记录
   *
   * @param operator 操作人（模糊匹配）
   * @param pageSize 每页记录数
   * @param current 当前页码
   * @param created_at 创建时间（UTC时间字符串）
   * @returns 控制台审计列表
   */
  @UseGuards(AdminGuard)
  @Get('console')
  queryConsoleAudits(
    @Query('operator') operator?: string,
    @Query('pageSize') pageSize?: number,
    @Query('current') current?: number,
    @Query('created_at') created_at?: string,
  ) {
    return this.auditService.queryConsoleAudits({
      operator,
      pageSize,
      current,
      created_at,
    });
  }
}
