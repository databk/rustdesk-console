import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { promises as fs, type StatsFs } from 'fs';
import * as os from 'os';
import * as si from 'systeminformation';
import { User } from '../user/entities/user.entity';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { FileAudit } from '../audit/entities/file-audit.entity';
import { AlarmAudit } from '../audit/entities/alarm-audit.entity';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { AddressBook } from '../address-book/entities/address-book.entity';
import { UserGroup } from '../user-group/entities/user-group.entity';
import { Role } from '../rbac/entities/role.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
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
    @InjectRepository(AddressBook)
    private readonly addressBookRepository: Repository<AddressBook>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepository: Repository<UserGroup>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
  ) {}

  async getDashboard(): Promise<DashboardDataDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      userTotal,
      adminCount,
      deviceTotal,
      deviceOnline,
      connectionsToday,
      fileTransfersToday,
      addressBooksCount,
      userGroupsCount,
      deviceGroupsCount,
      rolesCount,
      strategiesCount,
    ] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { isAdmin: true } }),
      this.peerRepository.count(),
      this.peerRepository
        .createQueryBuilder('peer')
        .where('peer.lastHeartbeat >= :threshold', { threshold: new Date(Date.now() - 60 * 1000) })
        .andWhere('peer.status = :status', { status: PeerStatus.ACTIVE })
        .getCount(),
      this.connectionAuditRepository.count({ where: { createdAt: Between(today, new Date()) } }),
      this.fileAuditRepository.count({ where: { createdAt: Between(today, new Date()) } }),
      this.addressBookRepository.count(),
      this.userGroupRepository.count(),
      this.deviceGroupRepository.count(),
      this.roleRepository.count(),
      this.strategyRepository.count(),
    ]);

    const todayConnections = await this.connectionAuditRepository
      .createQueryBuilder('conn')
      .where('conn.createdAt >= :today', { today })
      .andWhere('conn.closedAt IS NOT NULL')
      .andWhere('conn.establishedAt IS NOT NULL')
      .getMany();

    let successCount = 0;
    todayConnections.forEach((conn) => {
      if (conn.closedAt && conn.establishedAt) {
        successCount++;
      }
    });

    const failureCount = await this.connectionAuditRepository
      .createQueryBuilder('conn')
      .where('conn.createdAt >= :today', { today })
      .andWhere('conn.establishedAt IS NULL')
      .andWhere('conn.closedAt IS NOT NULL')
      .getCount();

    const todayFileTransfers = await this.fileAuditRepository.find({
      where: { createdAt: Between(today, new Date()) },
    });
    let uploadToday = 0;
    let downloadToday = 0;
    todayFileTransfers.forEach((file) => {
      if (file.type === 0) uploadToday++;
      else if (file.type === 1) downloadToday++;
    });

    const systemStatus = await this.getSystemStatus();

    return {
      users: {
        total: userTotal,
        admin: adminCount,
        normal: userTotal - adminCount,
      },
      devices: {
        total: deviceTotal,
        online: deviceOnline,
        offline: deviceTotal - deviceOnline,
      },
      connections: {
        today: connectionsToday,
        successCount,
        failureCount,
      },
      files: {
        transferredToday: fileTransfersToday,
        uploadToday,
        downloadToday,
      },
      counts: {
        addressBooks: addressBooksCount,
        groups: userGroupsCount + deviceGroupsCount,
        roles: rolesCount,
        strategies: strategiesCount,
      },
      systemStatus,
    };
  }

  async getTrends(range: string = '7d'): Promise<DashboardTrendsDto> {
    const days = this.parseRange(range);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [connectionTrend, newUserTrend, alarmTrend] = await Promise.all([
      this.getConnectionTrend(startDate, days),
      this.getUserNewTrend(startDate, days),
      this.getAlarmTrend(startDate, days),
    ]);

    return { connectionTrend, newUserTrend, alarmTrend };
  }

  private async getConnectionTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; count: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = await this.connectionAuditRepository.count({
        where: { createdAt: Between(date, nextDate) },
      });

      trend.push({
        date: date.toISOString().split('T')[0],
        count,
      });
    }
    return trend;
  }

  private async getUserNewTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; newUsers: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const newUsers = await this.userRepository.count({
        where: { createdAt: Between(date, nextDate) },
      });

      trend.push({
        date: date.toISOString().split('T')[0],
        newUsers,
      });
    }
    return trend;
  }

  private async getAlarmTrend(startDate: Date, days: number) {
    const trend: Array<{ date: string; count: number }> = [];
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
        count: total,
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
