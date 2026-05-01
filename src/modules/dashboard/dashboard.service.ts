import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import * as si from 'systeminformation';
import { User, UserStatus } from '../user/entities/user.entity';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { FileAudit } from '../audit/entities/file-audit.entity';
import { AlarmAudit } from '../audit/entities/alarm-audit.entity';
import {
  DashboardOverviewDto,
  DashboardStatisticsDto,
  DashboardTrendsDto,
  DashboardRealtimeDto,
} from './dto/dashboard-overview.dto';

/**
 * Dashboard 服务
 * 提供数据统计和分析功能
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Peer)
    private readonly peerRepository: Repository<Peer>,
    @InjectRepository(DeviceGroup)
    private readonly deviceGroupRepository: Repository<DeviceGroup>,
    @InjectRepository(ConnectionAudit)
    private readonly connectionAuditRepository: Repository<ConnectionAudit>,
    @InjectRepository(FileAudit)
    private readonly fileAuditRepository: Repository<FileAudit>,
    @InjectRepository(AlarmAudit)
    private readonly alarmAuditRepository: Repository<AlarmAudit>,
  ) {}

  /**
   * 获取总览数据
   */
  async getOverview(): Promise<DashboardOverviewDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 用户统计
    const userTotal = await this.userRepository.count();
    const userActive = await this.userRepository.count({
      where: { status: UserStatus.ACTIVE },
    });
    // TODO: 实现在线用户统计（需要心跳或会话管理）
    const userOnline = 0;
    const newUsersToday = await this.userRepository.count({
      where: {
        createdAt: Between(today, new Date()),
      },
    });

    // 设备统计
    const deviceTotal = await this.peerRepository.count();
    const deviceActive = await this.peerRepository.count({
      where: { status: PeerStatus.ACTIVE },
    });

    // 在线设备统计：最近5分钟内有心跳的设备
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const deviceOnline = await this.peerRepository
      .createQueryBuilder('peer')
      .where('peer.updatedAt >= :threshold', { threshold: fiveMinutesAgo })
      .andWhere('peer.status = :status', { status: PeerStatus.ACTIVE })
      .getCount();

    const deviceGroups = await this.deviceGroupRepository.count();

    // 连接统计
    const connectionsToday = await this.connectionAuditRepository.count({
      where: {
        createdAt: Between(today, new Date()),
      },
    });

    // 计算平均连接时长
    const todayConnections = await this.connectionAuditRepository
      .createQueryBuilder('conn')
      .where('conn.createdAt >= :today', { today })
      .andWhere('conn.closedAt IS NOT NULL')
      .andWhere('conn.establishedAt IS NOT NULL')
      .getMany();

    let totalDuration = 0;
    let connectionCount = 0;
    todayConnections.forEach((conn) => {
      if (conn.closedAt && conn.establishedAt) {
        const duration =
          (conn.closedAt.getTime() - conn.establishedAt.getTime()) / 1000 / 60; // 分钟
        totalDuration += duration;
        connectionCount++;
      }
    });
    const avgDuration = connectionCount > 0 ? totalDuration / connectionCount : 0;

    // TODO: 实现活跃连接统计（需要实时连接管理）
    const activeConnections = 0;

    // 审计统计
    const totalAlarms = await this.alarmAuditRepository.count();
    // TODO: 需要在 AlarmAudit 实体中添加 isRead 和 level 字段
    const unreadAlarms = 0;
    const criticalAlarms = 0;

    // 文件传输统计
    const fileTransfers = await this.fileAuditRepository.count({
      where: {
        createdAt: Between(today, new Date()),
      },
    });

    const fileRecords = await this.fileAuditRepository
      .createQueryBuilder('file')
      .where('file.createdAt >= :today', { today })
      .getMany();

    let totalFileSize = 0;
    fileRecords.forEach((file) => {
      // 计算文件总大小
      if (file.files && Array.isArray(file.files)) {
        file.files.forEach(([, size]) => {
          totalFileSize += size || 0;
        });
      }
    });

    return {
      users: {
        total: userTotal,
        active: userActive,
        online: userOnline,
        newToday: newUsersToday,
      },
      devices: {
        total: deviceTotal,
        online: deviceOnline,
        offline: deviceTotal - deviceOnline,
        groups: deviceGroups,
      },
      connections: {
        active: activeConnections,
        today: connectionsToday,
        avgDuration: Math.round(avgDuration * 10) / 10,
      },
      audits: {
        alarms: totalAlarms,
        unreadAlarms,
        criticalAlarms,
      },
      files: {
        transferred: fileTransfers,
        totalSize: this.formatFileSize(totalFileSize),
      },
    };
  }

  /**
   * 获取统计数据
   */
  async getStatistics(): Promise<DashboardStatisticsDto> {
    // 用户分布
    const adminCount = await this.userRepository.count({
      where: { isAdmin: true },
    });
    const normalUserCount = await this.userRepository.count({
      where: { isAdmin: false },
    });

    const activeUsers = await this.userRepository.count({
      where: { status: UserStatus.ACTIVE },
    });
    const inactiveUsers = await this.userRepository.count({
      where: { status: UserStatus.DISABLED },
    });
    const unverifiedUsers = await this.userRepository.count({
      where: { status: UserStatus.UNVERIFIED },
    });

    // 设备分布
    const deviceGroups = await this.deviceGroupRepository.find({
      relations: ['peers'],
    });
    const deviceByGroup = deviceGroups.map((group) => ({
      groupId: group.guid,
      groupName: group.name,
      count: group.peers ? group.peers.length : 0,
    }));

    // 在线设备统计：最近5分钟内有心跳的设备
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineDevices = await this.peerRepository
      .createQueryBuilder('peer')
      .where('peer.updatedAt >= :threshold', { threshold: fiveMinutesAgo })
      .andWhere('peer.status = :status', { status: PeerStatus.ACTIVE })
      .getCount();

    const totalDevices = await this.peerRepository.count();

    // 连接分析
    const allConnections = await this.connectionAuditRepository
      .createQueryBuilder('conn')
      .where('conn.closedAt IS NOT NULL')
      .andWhere('conn.establishedAt IS NOT NULL')
      .getMany();

    let totalDuration = 0;
    let successCount = 0;
    let failureCount = 0;

    allConnections.forEach((conn) => {
      if (conn.closedAt && conn.establishedAt) {
        const duration =
          (conn.closedAt.getTime() - conn.establishedAt.getTime()) / 1000 / 60;
        totalDuration += duration;
        successCount++;
      }
    });

    // 统计失败的连接（没有 establishedAt 但有 closedAt）
    const failedConnections = await this.connectionAuditRepository
      .createQueryBuilder('conn')
      .where('conn.establishedAt IS NULL')
      .getCount();
    failureCount = failedConnections;

    const totalConnections = successCount + failureCount;
    const successRate =
      totalConnections > 0 ? (successCount / totalConnections) * 100 : 0;

    // 文件传输统计
    const allFileTransfers = await this.fileAuditRepository.find();
    let totalFilesSize = 0;
    let uploadCount = 0;
    let downloadCount = 0;

    allFileTransfers.forEach((file) => {
      // 计算文件总大小
      if (file.files && Array.isArray(file.files)) {
        file.files.forEach(([, size]) => {
          totalFilesSize += size || 0;
        });
      }
      // 根据类型统计上传/下载
      if (file.type === 0) {
        uploadCount++;
      } else if (file.type === 1) {
        downloadCount++;
      }
    });

    return {
      userDistribution: {
        byRole: {
          admin: adminCount,
          user: normalUserCount,
        },
        byStatus: {
          active: activeUsers,
          inactive: inactiveUsers,
          disabled: inactiveUsers,
          unverified: unverifiedUsers,
        },
      },
      deviceDistribution: {
        byGroup: deviceByGroup,
        byStatus: {
          online: onlineDevices,
          offline: totalDevices - onlineDevices,
        },
      },
      connectionAnalysis: {
        avgDuration:
          successCount > 0 ? Math.round((totalDuration / successCount) * 10) / 10 : 0,
        totalDuration: Math.round(totalDuration),
        successRate: Math.round(successRate * 10) / 10,
        failureCount,
      },
      fileTransfer: {
        totalFiles: allFileTransfers.length,
        totalSize: totalFilesSize,
        uploadCount,
        downloadCount,
      },
    };
  }

  /**
   * 获取趋势数据
   */
  async getTrends(
    range: string = '7d',
    metric: string = 'all',
  ): Promise<DashboardTrendsDto> {
    const days = this.parseRange(range);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const result: DashboardTrendsDto = {};

    // 连接趋势
    if (metric === 'all' || metric === 'connection') {
      result.connectionTrend = await this.getConnectionTrend(startDate, days);
    }

    // 用户活跃趋势
    if (metric === 'all' || metric === 'user') {
      result.userActiveTrend = await this.getUserActiveTrend(startDate, days);
    }

    // 告警趋势
    if (metric === 'all' || metric === 'alarm') {
      result.alarmTrend = await this.getAlarmTrend(startDate, days);
    }

    return result;
  }

  /**
   * 获取实时数据
   */
  async getRealtime(): Promise<DashboardRealtimeDto> {
    // 获取最近 10 条活跃连接
    const recentConnections = await this.connectionAuditRepository.find({
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const activeConnections = recentConnections.map((conn) => ({
      id: conn.id.toString(),
      userId: conn.peerId || 'unknown',
      userName: conn.peerName || 'unknown',
      deviceId: conn.deviceId,
      deviceName: conn.deviceUuid,
      startTime: conn.establishedAt || conn.createdAt,
      duration: conn.closedAt && conn.establishedAt
        ? Math.round((conn.closedAt.getTime() - conn.establishedAt.getTime()) / 1000 / 60)
        : 0,
    }));

    // 获取最近事件
    const recentConnectionEvents = await this.connectionAuditRepository.find({
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const recentFileEvents = await this.fileAuditRepository.find({
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const recentAlarmEvents = await this.alarmAuditRepository.find({
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const recentEvents = [
      ...recentConnectionEvents.map((e) => ({
        type: 'connection' as const,
        action: e.action,
        user: e.peerName || 'unknown',
        target: e.deviceId,
        timestamp: e.createdAt,
        status: 'success' as const,
      })),
      ...recentFileEvents.map((e) => ({
        type: 'file' as const,
        action: e.type === 0 ? 'send' : 'receive',
        user: e.clientName || 'unknown',
        target: e.path || 'unknown',
        timestamp: e.createdAt,
        status: 'success' as const,
      })),
      ...recentAlarmEvents.map((e) => ({
        type: 'alarm' as const,
        action: 'alarm',
        user: e.deviceId || 'system',
        target: e.infoName || 'alarm',
        timestamp: e.createdAt,
        status: 'warning' as const,
      })),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10);

    // 系统状态（真实数据）
    const systemStatus = await this.getSystemStatus();

    return {
      activeConnections,
      recentEvents,
      systemStatus,
    };
  }

  /**
   * 获取连接趋势
   */
  private async getConnectionTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; count: number; avgDuration: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = await this.connectionAuditRepository.count({
        where: {
          createdAt: Between(date, nextDate),
        },
      });

      const connections = await this.connectionAuditRepository
        .createQueryBuilder('conn')
        .where('conn.createdAt >= :start', { start: date })
        .andWhere('conn.createdAt < :end', { end: nextDate })
        .andWhere('conn.closedAt IS NOT NULL')
        .andWhere('conn.establishedAt IS NOT NULL')
        .getMany();

      let totalDuration = 0;
      connections.forEach((conn) => {
        if (conn.closedAt && conn.establishedAt) {
          totalDuration +=
            (conn.closedAt.getTime() - conn.establishedAt.getTime()) / 1000 / 60;
        }
      });

      trend.push({
        date: date.toISOString().split('T')[0],
        count,
        avgDuration:
          connections.length > 0
            ? Math.round((totalDuration / connections.length) * 10) / 10
            : 0,
      });
    }
    return trend;
  }

  /**
   * 获取用户活跃趋势
   */
  private async getUserActiveTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; newUsers: number; activeUsers: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const newUsers = await this.userRepository.count({
        where: {
          createdAt: Between(date, nextDate),
        },
      });

      // 活跃用户（简化处理，实际应根据登录记录）
      const activeUsers = await this.userRepository.count({
        where: { status: UserStatus.ACTIVE },
      });

      trend.push({
        date: date.toISOString().split('T')[0],
        newUsers,
        activeUsers,
      });
    }
    return trend;
  }

  /**
   * 获取告警趋势
   */
  private async getAlarmTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; critical: number; warning: number; info: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      // TODO: 需要在 AlarmAudit 实体中添加 level 字段
      const total = await this.alarmAuditRepository.count({
        where: {
          createdAt: Between(date, nextDate),
        },
      });

      trend.push({
        date: date.toISOString().split('T')[0],
        critical: 0,
        warning: 0,
        info: total,
      });
    }
    return trend;
  }

  /**
   * 解析时间范围
   */
  private parseRange(range: string): number {
    switch (range) {
      case '7d':
        return 7;
      case '30d':
        return 30;
      case '90d':
        return 90;
      default:
        return 7;
    }
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * 获取系统状态
   * 使用 systeminformation 库获取真实的系统监控数据
   *
   * 注意: 在 Docker 容器中运行时:
   * - 默认只能获取容器内的资源使用情况
   * - 如需获取宿主机信息,需要挂载 /proc 和 /sys 文件系统
   * - Docker 运行示例: docker run -v /proc:/host/proc:ro -v /sys:/host/sys:ro
   */
  private async getSystemStatus() {
    try {
      // 获取 CPU 当前使用率
      const cpuData = await si.currentLoad();
      const cpu = Math.round(cpuData.currentLoad * 10) / 10;

      // 获取内存使用情况
      const memData = await si.mem();
      const memory = Math.round((memData.used / memData.total) * 1000) / 10;

      // 获取磁盘使用情况（第一个磁盘）
      const fsData = await si.fsSize();
      let disk = 0;
      if (fsData && fsData.length > 0) {
        disk = Math.round(fsData[0].use * 10) / 10;
      }

      // 系统运行时间（秒）
      const uptime = process.uptime();

      return {
        cpu,
        memory,
        disk,
        uptime,
      };
    } catch (error) {
      // 如果获取失败，返回默认值
      return {
        cpu: 0,
        memory: 0,
        disk: 0,
        uptime: process.uptime(),
      };
    }
  }
}
