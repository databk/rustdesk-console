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
import { UserToken } from '../user/entities/user-token.entity';
import { Invitation } from '../user/entities/invitation.entity';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { getDbPath } from '../../common/utils/data-dir.util';
import { DeviceGroupUserPermission } from '../device-group/entities/device-group-user-permission.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { FileAudit } from '../audit/entities/file-audit.entity';
import { AlarmAudit } from '../audit/entities/alarm-audit.entity';
import { AddressBook } from '../address-book/entities/address-book.entity';
import { AddressBookPeer } from '../address-book/entities/address-book-peer.entity';
import { AddressBookTag } from '../address-book/entities/address-book-tag.entity';
import { AddressBookRule } from '../address-book/entities/address-book-rule.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { UserGroup } from '../user-group/entities/user-group.entity';
import { PasskeyCredential } from '../auth/entities/passkey-credential.entity';
import { OidcProvider } from '../oidc/entities/oidc-provider.entity';
import { NexusBuild } from '../nexus/entities/nexus-build.entity';
import { NexusToken } from '../nexus/entities/nexus-token.entity';
import { ActiveConnection } from '../heartbeat/entities/active-connection.entity';
import { resolveAssetPath } from '../../common/utils/runtime-paths';
import {
  UpdateChannel,
  UpdateCheckRequest,
  UpdateCheckResponse,
} from './dto/update-check.dto';

const UPDATE_API_URL = 'https://api.databk.top/v1/update/check';
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const INSTALL_ID_KEY = 'system.installId';
const INSTALL_ID_CATEGORY = 'system';
const LEGACY_INSTALL_ID_KEY = 'install_id';
const LEGACY_INSTALL_ID_CATEGORY = 'update_check';

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
    @InjectRepository(UserToken)
    private readonly userTokenRepository: Repository<UserToken>,
    @InjectRepository(Invitation)
    private readonly invitationRepository: Repository<Invitation>,
    @InjectRepository(Peer)
    private readonly peerRepository: Repository<Peer>,
    @InjectRepository(DeviceGroup)
    private readonly deviceGroupRepository: Repository<DeviceGroup>,
    @InjectRepository(DeviceGroupUserPermission)
    private readonly deviceGroupPermissionRepository: Repository<DeviceGroupUserPermission>,
    @InjectRepository(ConnectionAudit)
    private readonly connectionAuditRepository: Repository<ConnectionAudit>,
    @InjectRepository(FileAudit)
    private readonly fileAuditRepository: Repository<FileAudit>,
    @InjectRepository(AlarmAudit)
    private readonly alarmAuditRepository: Repository<AlarmAudit>,
    @InjectRepository(AddressBook)
    private readonly addressBookRepository: Repository<AddressBook>,
    @InjectRepository(AddressBookPeer)
    private readonly addressBookPeerRepository: Repository<AddressBookPeer>,
    @InjectRepository(AddressBookTag)
    private readonly addressBookTagRepository: Repository<AddressBookTag>,
    @InjectRepository(AddressBookRule)
    private readonly addressBookRuleRepository: Repository<AddressBookRule>,
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepository: Repository<UserGroup>,
    @InjectRepository(PasskeyCredential)
    private readonly passkeyCredentialRepository: Repository<PasskeyCredential>,
    @InjectRepository(OidcProvider)
    private readonly oidcProviderRepository: Repository<OidcProvider>,
    @InjectRepository(NexusBuild)
    private readonly nexusBuildRepository: Repository<NexusBuild>,
    @InjectRepository(NexusToken)
    private readonly nexusTokenRepository: Repository<NexusToken>,
    @InjectRepository(ActiveConnection)
    private readonly activeConnectionRepository: Repository<ActiveConnection>,
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
   *
   * 存储在 system.installId（category=system），与统一 key 格式一致。
   * 兼容从旧键 (install_id, category=update_check) 的自动迁移，
   * 迁移在单事务内完成，保留原值避免实例标识变化。
   */
  async getInstallId(): Promise<string> {
    const setting = await this.settingRepository.findOne({
      where: { key: INSTALL_ID_KEY, category: INSTALL_ID_CATEGORY },
    });
    if (setting) return setting.value;

    const legacy = await this.settingRepository.findOne({
      where: {
        key: LEGACY_INSTALL_ID_KEY,
        category: LEGACY_INSTALL_ID_CATEGORY,
      },
    });
    if (legacy) {
      await this.settingRepository.manager.transaction(async (manager) => {
        const repo = manager.getRepository(SystemSetting);
        await repo.save(
          repo.create({
            key: INSTALL_ID_KEY,
            value: legacy.value,
            category: INSTALL_ID_CATEGORY,
          }),
        );
        await repo.delete({
          key: LEGACY_INSTALL_ID_KEY,
          category: LEGACY_INSTALL_ID_CATEGORY,
        });
      });
      this.logger.log('Migrated install_id to system.installId');
      return legacy.value;
    }

    const newId = uuidv4();
    await this.setSetting(INSTALL_ID_CATEGORY, INSTALL_ID_KEY, newId);
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

    const dbPath = getDbPath();
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
    const emptyNexusBuildsByStatus = {
      pending: 0,
      building: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const results = await Promise.allSettled([
      this.userRepository.count(),
      this.userRepository.count({ where: { isAdmin: true } }),
      this.userRepository.count({
        where: { updatedAt: Between(sevenDaysAgo, now) },
      }),
      this.userGroupRepository.count(),
      this.peerRepository.count(),
      this.getOnlineDeviceCount(),
      this.deviceGroupRepository.count(),
      this.deviceGroupPermissionRepository.count(),
      this.activeConnectionRepository.count(),
      this.connectionAuditRepository.count({
        where: { createdAt: Between(sevenDaysAgo, now) },
      }),
      this.addressBookRepository.count(),
      this.addressBookRepository.count({ where: { isPersonal: true } }),
      this.addressBookRepository.count({ where: { isShared: true } }),
      this.addressBookPeerRepository.count(),
      this.addressBookTagRepository.count(),
      this.addressBookRuleRepository.count(),
      this.strategyRepository.count(),
      this.passkeyCredentialRepository.count(),
      this.userTokenRepository
        .createQueryBuilder('token')
        .where('token.isRevoked = :revoked', { revoked: false })
        .andWhere('token.expiresAt > :now', { now })
        .getCount(),
      this.userTokenRepository.count({ where: { isRevoked: true } }),
      this.invitationRepository
        .createQueryBuilder('invitation')
        .where('invitation.usedAt IS NULL')
        .andWhere('invitation.expiresAt > :now', { now })
        .getCount(),
      this.invitationRepository
        .createQueryBuilder('invitation')
        .where('invitation.usedAt IS NOT NULL')
        .getCount(),
      this.oidcProviderRepository.count(),
      this.oidcProviderRepository.count({ where: { enabled: true } }),
      this.nexusBuildRepository.count(),
      this.getNexusBuildsByStatus(),
      this.nexusTokenRepository.count(),
      this.fileAuditRepository.count({
        where: { createdAt: Between(sevenDaysAgo, now) },
      }),
      this.alarmAuditRepository.count({
        where: { createdAt: Between(sevenDaysAgo, now) },
      }),
    ]);

    const value = <T>(index: number, fallback: T): T => {
      const r = results[index];
      return r.status === 'fulfilled' ? (r.value as T) : fallback;
    };

    return {
      users: {
        total: value(0, 0),
        admins: value(1, 0),
        active_7d: value(2, 0),
        groups: value(3, 0),
      },
      devices: {
        total: value(4, 0),
        online: value(5, 0),
        groups: value(6, 0),
        group_permissions: value(7, 0),
      },
      connections: {
        active: value(8, 0),
        audited_7d: value(9, 0),
      },
      address_book: {
        total: value(10, 0),
        personal: value(11, 0),
        shared: value(12, 0),
        peers: value(13, 0),
        tags: value(14, 0),
        rules: value(15, 0),
      },
      strategy: { total: value(16, 0) },
      auth: {
        passkey_credentials: value(17, 0),
        active_tokens: value(18, 0),
        revoked_tokens: value(19, 0),
        pending_invitations: value(20, 0),
        used_invitations: value(21, 0),
        oidc_providers: value(22, 0),
        oidc_enabled_providers: value(23, 0),
      },
      nexus: {
        builds_total: value(24, 0),
        builds_by_status: value(25, emptyNexusBuildsByStatus),
        tokens: value(26, 0),
      },
      audit: {
        file_transfers_7d: value(27, 0),
        alarms_7d: value(28, 0),
      },
    };
  }

  private async getOnlineDeviceCount(): Promise<number> {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    return this.peerRepository
      .createQueryBuilder('peer')
      .where('peer.lastHeartbeat >= :threshold', { threshold: oneMinuteAgo })
      .andWhere('peer.status = :status', { status: PeerStatus.ACTIVE })
      .getCount();
  }

  private async getNexusBuildsByStatus(): Promise<{
    pending: number;
    building: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const empty = {
      pending: 0,
      building: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    try {
      const rows = await this.nexusBuildRepository
        .createQueryBuilder('build')
        .select('build.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('build.status')
        .getRawMany<{ status: string; count: string }>();

      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(row.status, Number(row.count));
      }

      return {
        pending: map.get('pending') ?? 0,
        building: map.get('building') ?? 0,
        completed: map.get('completed') ?? 0,
        failed: map.get('failed') ?? 0,
        cancelled: map.get('cancelled') ?? 0,
      };
    } catch {
      return empty;
    }
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
