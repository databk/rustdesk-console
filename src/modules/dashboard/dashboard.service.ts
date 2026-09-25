import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { promises as fs, type StatsFs } from 'fs';
import * as os from 'os';
import * as si from 'systeminformation';
import { User, UserStatus } from '../user/entities/user.entity';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { FileAudit } from '../audit/entities/file-audit.entity';
import { AlarmAudit } from '../audit/entities/alarm-audit.entity';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { getDbPath } from '../../common/utils/data-dir.util';
import { DashboardDataDto, DashboardTrendsDto } from './dto/dashboard-overview.dto';

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
    @InjectRepository(Sysinfo)
    private readonly sysinfoRepository: Repository<Sysinfo>,
  ) {}

  async getDashboard(): Promise<DashboardDataDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      userTotal,
      userActive,
      newUsersToday,
      deviceTotal,
      deviceOnline,
      deviceGroups,
      connectionsToday,
      totalAlarms,
      alarmsToday,
      fileTransfersToday,
      recentConnections,
      recentConnectionEvents,
      recentFileEvents,
      recentAlarmEvents,
    ] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { status: UserStatus.ACTIVE } }),
      this.userRepository.count({ where: { createdAt: Between(today, new Date()) } }),
      this.peerRepository.count(),
      this.peerRepository
        .createQueryBuilder('peer')
        .where('peer.lastHeartbeat >= :threshold', { threshold: new Date(Date.now() - 60 * 1000) })
        .andWhere('peer.status = :status', { status: PeerStatus.ACTIVE })
        .getCount(),
      this.deviceGroupRepository.count(),
      this.connectionAuditRepository.count({ where: { createdAt: Between(today, new Date()) } }),
      this.alarmAuditRepository.count(),
      this.alarmAuditRepository.count({ where: { createdAt: Between(today, new Date()) } }),
      this.fileAuditRepository.count({ where: { createdAt: Between(today, new Date()) } }),
      this.connectionAuditRepository.find({ order: { createdAt: 'DESC' }, take: 10 }),
      this.connectionAuditRepository.find({ order: { createdAt: 'DESC' }, take: 5 }),
      this.fileAuditRepository.find({ order: { createdAt: 'DESC' }, take: 5 }),
      this.alarmAuditRepository.find({ order: { createdAt: 'DESC' }, take: 5 }),
    ]);

    const todayConnections = await this.connectionAuditRepository
      .createQueryBuilder('conn')
      .where('conn.createdAt >= :today', { today })
      .andWhere('conn.closedAt IS NOT NULL')
      .andWhere('conn.establishedAt IS NOT NULL')
      .getMany();

    let totalDuration = 0;
    let successCount = 0;
    todayConnections.forEach((conn) => {
      if (conn.closedAt && conn.establishedAt) {
        totalDuration += (conn.closedAt.getTime() - conn.establishedAt.getTime()) / 1000 / 60;
        successCount++;
      }
    });

    const failedConnections = await this.connectionAuditRepository
      .createQueryBuilder('conn')
      .where('conn.establishedAt IS NULL')
      .getCount();

    const totalConnForRate = successCount + failedConnections;
    const successRate = totalConnForRate > 0 ? Math.round((successCount / totalConnForRate) * 1000) / 10 : 0;
    const avgDuration = successCount > 0 ? Math.round((totalDuration / successCount) * 10) / 10 : 0;

    const allFileTransfers = await this.fileAuditRepository.find();
    let totalFileSize = 0;
    let uploadCount = 0;
    let downloadCount = 0;
    allFileTransfers.forEach((file) => {
      try {
        if (file.files) {
          let filesArray: unknown = file.files;
          if (typeof file.files === 'string') {
            filesArray = JSON.parse(file.files) as unknown[];
          }
          if (Array.isArray(filesArray)) {
            filesArray.forEach((item: unknown) => {
              if (Array.isArray(item) && item.length >= 2) {
                const size: unknown = item[1];
                totalFileSize += typeof size === 'number' ? size : 0;
              }
            });
          }
        }
      } catch {
        // skip
      }
      if (file.type === 0) uploadCount++;
      else if (file.type === 1) downloadCount++;
    });

    const allDeviceUuids = new Set<string>();
    recentConnections.forEach((conn) => allDeviceUuids.add(conn.deviceUuid));
    recentConnectionEvents.forEach((e) => allDeviceUuids.add(e.deviceUuid));
    recentAlarmEvents.forEach((e) => allDeviceUuids.add(e.deviceUuid));

    const uuidToIdMap = new Map<string, string>();
    const uuidToHostnameMap = new Map<string, string>();
    if (allDeviceUuids.size > 0) {
      const peers = await this.peerRepository
        .createQueryBuilder('peer')
        .where('peer.uuid IN (:...uuids)', { uuids: Array.from(allDeviceUuids) })
        .getMany();
      peers.forEach((peer) => uuidToIdMap.set(peer.uuid, peer.id));

      const sysinfos = await this.sysinfoRepository
        .createQueryBuilder('sysinfo')
        .where('sysinfo.uuid IN (:...uuids)', { uuids: Array.from(allDeviceUuids) })
        .getMany();
      sysinfos.forEach((s) => {
        if (s.hostname) uuidToHostnameMap.set(s.uuid, s.hostname);
      });
    }

    const activeConnections = recentConnections.map((conn) => ({
      id: conn.id.toString(),
      userName: conn.peerName || 'unknown',
      deviceName: uuidToHostnameMap.get(conn.deviceUuid) || conn.deviceUuid,
      startTime: conn.establishedAt || conn.createdAt,
      duration:
        conn.closedAt && conn.establishedAt
          ? Math.round((conn.closedAt.getTime() - conn.establishedAt.getTime()) / 1000 / 60)
          : 0,
    }));

    const recentEvents = [
      ...recentConnectionEvents.map((e) => ({
        type: 'connection' as const,
        action: e.action,
        user: e.peerName || 'unknown',
        target: uuidToIdMap.get(e.deviceUuid) || e.deviceId,
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
        user: uuidToIdMap.get(e.deviceUuid) || e.deviceId || 'system',
        target: e.infoName || 'alarm',
        timestamp: e.createdAt,
        status: 'warning' as const,
      })),
    ]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);

    const systemStatus = await this.getSystemStatus();

    return {
      users: {
        total: userTotal,
        active: userActive,
        newToday: newUsersToday,
      },
      devices: {
        total: deviceTotal,
        online: deviceOnline,
        offline: deviceTotal - deviceOnline,
        groups: deviceGroups,
      },
      connections: {
        today: connectionsToday,
        successRate,
        avgDuration,
      },
      alarms: {
        total: totalAlarms,
        today: alarmsToday,
      },
      files: {
        transferredToday: fileTransfersToday,
        totalSize: this.formatFileSize(totalFileSize),
        uploadCount,
        downloadCount,
      },
      activeConnections,
      recentEvents,
      systemStatus,
    };
  }

  async getTrends(range: string = '7d'): Promise<DashboardTrendsDto> {
    const days = this.parseRange(range);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [connectionTrend, userActiveTrend, alarmTrend] = await Promise.all([
      this.getConnectionTrend(startDate, days),
      this.getUserActiveTrend(startDate, days),
      this.getAlarmTrend(startDate, days),
    ]);

    return { connectionTrend, userActiveTrend, alarmTrend };
  }

  private async getConnectionTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; count: number; avgDuration: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = await this.connectionAuditRepository.count({
        where: { createdAt: Between(date, nextDate) },
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
          totalDuration += (conn.closedAt.getTime() - conn.establishedAt.getTime()) / 1000 / 60;
        }
      });

      trend.push({
        date: date.toISOString().split('T')[0],
        count,
        avgDuration: connections.length > 0 ? Math.round((totalDuration / connections.length) * 10) / 10 : 0,
      });
    }
    return trend;
  }

  private async getUserActiveTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; newUsers: number; activeUsers: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const newUsers = await this.userRepository.count({
        where: { createdAt: Between(date, nextDate) },
      });

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

  private async getAlarmTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; critical: number; warning: number; info: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const total = await this.alarmAuditRepository.count({
        where: { createdAt: Between(date, nextDate) },
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

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  private async getSystemStatus() {
    const databasePath = getDbPath();
    const [cpuResult, memoryResult, filesystemResult] = await Promise.allSettled([
      si.currentLoad(),
      si.mem(),
      fs.statfs(databasePath),
    ] as const);

    return {
      cpu:
        cpuResult.status === 'fulfilled'
          ? this.roundPercentage(cpuResult.value.currentLoad)
          : null,
      memory:
        memoryResult.status === 'fulfilled' && memoryResult.value.total > 0
          ? this.roundPercentage(
              ((memoryResult.value.total - memoryResult.value.available) / memoryResult.value.total) * 100,
            )
          : null,
      disk:
        filesystemResult.status === 'fulfilled'
          ? this.getDiskUsage(filesystemResult.value)
          : null,
      uptime: this.getSystemUptime(),
    };
  }

  private getDiskUsage(filesystem: StatsFs): number | null {
    if (filesystem.blocks <= 0) return null;
    return this.roundPercentage(
      ((filesystem.blocks - filesystem.bfree) / filesystem.blocks) * 100,
    );
  }

  private roundPercentage(value: number | undefined): number | null {
    if (value === undefined || !Number.isFinite(value)) return null;
    return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
  }

  private getSystemUptime(): number | null {
    try {
      const uptime = os.uptime();
      return Number.isFinite(uptime) && uptime >= 0 ? Math.floor(uptime) : null;
    } catch {
      return null;
    }
  }
}
