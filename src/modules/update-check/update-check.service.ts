import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import * as si from 'systeminformation';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { User } from '../user/entities/user.entity';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { resolveAssetPath } from '../../common/utils/runtime-paths';
import {
  UpdateChannel,
  UpdateCheckRequest,
  UpdateCheckResponse,
} from './dto/update-check.dto';

const UPDATE_API_URL = 'https://api.databk.top/v1/update/check';
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const EMPTY_RESPONSE: UpdateCheckResponse = {
  backend: { has_update: false },
  frontend: { has_update: false },
};

/**
 * 更新检查服务
 * 每1小时自动检查更新并缓存结果，前端请求时直接返回缓存
 */
@Injectable()
export class UpdateCheckService implements OnModuleInit {
  private readonly logger = new Logger(UpdateCheckService.name);
  private cachedResult: UpdateCheckResponse = { ...EMPTY_RESPONSE };
  private lastKnownFrontendVersion?: string;
  private isChecking = false;

  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepository: Repository<SystemSetting>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Peer)
    private readonly peerRepository: Repository<Peer>,
    @InjectRepository(DeviceGroup)
    private readonly deviceGroupRepository: Repository<DeviceGroup>,
    @InjectRepository(ConnectionAudit)
    private readonly connectionAuditRepository: Repository<ConnectionAudit>,
  ) {}

  async onModuleInit() {
    await this.loadPersistedFrontendVersion();
    await this.fetchUpdate();
  }

  @Interval(UPDATE_CHECK_INTERVAL_MS)
  async handleScheduledUpdateCheck() {
    await this.fetchUpdate();
  }

  async checkUpdate(frontendVersion?: string): Promise<UpdateCheckResponse> {
    if (frontendVersion && frontendVersion !== this.lastKnownFrontendVersion) {
      this.lastKnownFrontendVersion = frontendVersion;
      await this.setSetting(
        'update_check',
        'frontend_version',
        frontendVersion,
      );
    }
    return this.cachedResult;
  }

  private async loadPersistedFrontendVersion(): Promise<void> {
    const setting = await this.settingRepository.findOne({
      where: { key: 'frontend_version', category: 'update_check' },
    });
    if (setting) {
      this.lastKnownFrontendVersion = setting.value;
    }
  }

  private async fetchUpdate(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const payload = await this.buildRequestPayload(
        this.lastKnownFrontendVersion,
      );

      const response = await fetch(UPDATE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        this.logger.warn(
          `Update check API returned ${response.status}: ${response.statusText}`,
        );
        return;
      }

      const data = (await response.json()) as UpdateCheckResponse;
      this.cachedResult = data;
      this.logger.log('Update check completed successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Update check failed: ${message}`);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 获取更新通道
   */
  async getUpdateChannel(): Promise<UpdateChannel> {
    const setting = await this.settingRepository.findOne({
      where: { key: 'update_channel', category: 'update_check' },
    });
    const value = setting?.value;
    if (value === UpdateChannel.NIGHTLY) return UpdateChannel.NIGHTLY;
    return UpdateChannel.STABLE;
  }

  /**
   * 设置更新通道
   */
  async setUpdateChannel(channel: UpdateChannel): Promise<void> {
    await this.setSetting('update_check', 'update_channel', channel);
  }

  /**
   * 获取 install_id，首次生成并持久化
   */
  async getInstallId(): Promise<string> {
    const setting = await this.settingRepository.findOne({
      where: { key: 'install_id', category: 'update_check' },
    });
    if (setting) return setting.value;

    const newId = uuidv4();
    await this.setSetting('update_check', 'install_id', newId);
    return newId;
  }

  /**
   * 获取后端版本号
   * 优先读取 APP_VERSION 环境变量，回退到 package.json
   */
  getBackendVersion(): string {
    if (process.env.APP_VERSION) return process.env.APP_VERSION;

    try {
      const pkgPath = resolveAssetPath(
        __dirname,
        path.join('..', '..', '..', 'package.json'),
        'package.json',
      );
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        version?: string;
      };
      return pkg.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * 检测是否运行在 Docker 容器中
   */
  isDocker(): boolean {
    try {
      if (fs.existsSync('/.dockerenv')) return true;
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf-8');
      return cgroup.includes('docker') || cgroup.includes('containerd');
    } catch {
      return false;
    }
  }

  /**
   * 构建完整的请求负载
   */
  private async buildRequestPayload(
    frontendVersion?: string,
  ): Promise<UpdateCheckRequest> {
    const [
      osInfo,
      cpuInfo,
      cpuLoad,
      memInfo,
      fsInfo,
      installId,
      channel,
      stats,
    ] = await Promise.all([
      this.getOsInfo(),
      this.getCpuInfo(),
      this.getCpuLoad(),
      this.getMemInfo(),
      this.getDiskInfo(),
      this.getInstallId(),
      this.getUpdateChannel(),
      this.getStatistics(),
    ]);

    const dbPath = process.env.DB_PATH || 'rustdesk-console.db';
    let dbSize = 0;
    try {
      const stat = fs.statSync(dbPath);
      dbSize = stat.size;
    } catch {
      // 数据库文件不存在或无法访问
    }

    return {
      version: {
        backend: this.getBackendVersion(),
        frontend: frontendVersion || 'unknown',
      },
      deployment: {
        type: this.isDocker() ? 'docker' : 'manual',
        channel,
        install_id: installId,
      },
      system: {
        os: osInfo,
        cpu: { ...cpuInfo, load: cpuLoad },
        memory: memInfo,
        disk: fsInfo,
      },
      runtime: {
        node_version: process.version,
        process_uptime: Math.floor(process.uptime()),
        process_memory: process.memoryUsage().rss,
      },
      database: {
        type: 'sqlite',
        size: dbSize,
      },
      statistics: stats,
    };
  }

  private async getOsInfo() {
    try {
      const data = await si.osInfo();
      return {
        platform: process.platform,
        arch: process.arch,
        dist: data.distro,
        release: data.release,
        kernel: data.kernel,
        hostname: os.hostname(),
        uptime: os.uptime(),
      };
    } catch {
      return {
        platform: process.platform,
        arch: process.arch,
        dist: 'unknown',
        release: 'unknown',
        kernel: 'unknown',
        hostname: os.hostname(),
        uptime: os.uptime(),
      };
    }
  }

  private async getCpuInfo() {
    try {
      const data = await si.cpu();
      return {
        model: `${data.manufacturer} ${data.brand}`,
        cores: data.cores,
        speed: String(data.speed),
      };
    } catch {
      return { model: 'unknown', cores: 0, speed: '0' };
    }
  }

  private async getCpuLoad(): Promise<number> {
    try {
      const data = await si.currentLoad();
      return Math.round(data.currentLoad * 10) / 10;
    } catch {
      return 0;
    }
  }

  private async getMemInfo() {
    try {
      const data = await si.mem();
      return {
        total: data.total,
        used: data.used,
        active: data.active,
      };
    } catch {
      return { total: 0, used: 0, active: 0 };
    }
  }

  private async getDiskInfo() {
    try {
      const data = await si.fsSize();
      let total = 0;
      let used = 0;
      data.forEach((fs) => {
        total += fs.size;
        used += fs.used;
      });
      return { total, used };
    } catch {
      return { total: 0, used: 0 };
    }
  }

  private async getStatistics() {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        adminUsers,
        activeUsers7d,
        totalDevices,
        onlineDevices,
        deviceGroups,
        connections7d,
      ] = await Promise.all([
        this.userRepository.count(),
        this.userRepository.count({ where: { isAdmin: true } }),
        this.userRepository.count({
          where: { updatedAt: Between(sevenDaysAgo, new Date()) },
        }),
        this.peerRepository.count(),
        this.getOnlineDeviceCount(),
        this.deviceGroupRepository.count(),
        this.connectionAuditRepository.count({
          where: { createdAt: Between(sevenDaysAgo, new Date()) },
        }),
      ]);

      return {
        users: {
          total: totalUsers,
          admins: adminUsers,
          active_7d: activeUsers7d,
        },
        devices: {
          total: totalDevices,
          online: onlineDevices,
          groups: deviceGroups,
        },
        connections: {
          total_7d: connections7d,
        },
      };
    } catch {
      return {
        users: { total: 0, admins: 0, active_7d: 0 },
        devices: { total: 0, online: 0, groups: 0 },
        connections: { total_7d: 0 },
      };
    }
  }

  private async getOnlineDeviceCount(): Promise<number> {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    return this.peerRepository
      .createQueryBuilder('peer')
      .where('peer.lastHeartbeat >= :threshold', { threshold: oneMinuteAgo })
      .andWhere('peer.status = :status', { status: PeerStatus.ACTIVE })
      .getCount();
  }

  /**
   * 通用设置存储（upsert）
   */
  private async setSetting(
    category: string,
    key: string,
    value: string,
  ): Promise<void> {
    let setting = await this.settingRepository.findOne({ where: { key } });
    if (setting) {
      setting.value = value;
    } else {
      setting = this.settingRepository.create({ key, value, category });
    }
    await this.settingRepository.save(setting);
  }
}
