import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { createReadStream, createWriteStream, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { NexusToken } from './entities/nexus-token.entity';
import { NexusBuild } from './entities/nexus-build.entity';
import {
  NexusLoginResponse,
  NexusAuthStatusResponse,
  NexusBindStatusResponse,
} from './dto/nexus-auth.dto';
import {
  NexusGenerateDto,
  NexusGenerateResponse,
  NexusBuildStatusResponse,
} from './dto/nexus-client.dto';

const NEXUS_BASE_URL = 'https://api.databk.top';
const DEFAULT_STORAGE_PATH = './data/nexus-builds';
const POLL_INTERVAL_MS = 10_000;

@Injectable()
export class NexusService implements OnModuleInit {
  private readonly logger = new Logger(NexusService.name);
  private readonly storagePath: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** 内存中暂存 login_id 与 userGuid 的映射，用于轮询成功后关联用户 */
  private loginSessionMap = new Map<string, string>();

  /** 正在下载的 request_id 集合，防止并发重复下载 */
  private downloadingSet = new Set<string>();

  constructor(
    @InjectRepository(NexusToken)
    private nexusTokenRepository: Repository<NexusToken>,
    @InjectRepository(NexusBuild)
    private nexusBuildRepository: Repository<NexusBuild>,
    private configService: ConfigService,
  ) {
    this.storagePath = this.configService.get<string>(
      'NEXUS_STORAGE_PATH',
      DEFAULT_STORAGE_PATH,
    );
  }

  async onModuleInit() {
    // 启动定时轮询
    this.pollTimer = setInterval(() => this.pollActiveBuilds(), POLL_INTERVAL_MS);
    // 首次立即执行一次
    await this.pollActiveBuilds();
  }

  /**
   * 定时轮询所有进行中的构建任务
   * 每隔 10 秒查询一次 Nexus，更新状态并下载产物
   */
  private async pollActiveBuilds() {
    try {
      const activeBuilds = await this.nexusBuildRepository.find({
        where: [
          { status: 'pending' as NexusBuild['status'] },
          { status: 'building' as NexusBuild['status'] },
        ],
      });

      if (activeBuilds.length === 0) return;

      for (const build of activeBuilds) {
        await this.syncBuildStatus(build);
      }
    } catch (err) {
      this.logger.error(`Error polling active builds: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * 同步单个构建任务的状态
   */
  private async syncBuildStatus(build: NexusBuild) {
    const nexusToken = await this.nexusTokenRepository.findOne({
      where: { userGuid: build.userGuid },
    });

    if (!nexusToken || nexusToken.isExpired()) {
      // Nexus Token 不可用，标记任务失败
      await this.nexusBuildRepository.update(
        { requestId: build.requestId },
        { status: 'failed', message: 'Nexus Token 已过期' },
      );
      return;
    }

    const response = await this.fetchNexus(
      `/v1/client/generate/${encodeURIComponent(build.requestId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${nexusToken.nexusToken}` },
      },
    );

    if (!response.ok) {
      this.logger.warn(
        `Poll build ${build.requestId} failed: ${response.status}`,
      );
      return;
    }

    const data = (await response.json()) as NexusBuildStatusResponse;

    // 更新构建记录
    await this.nexusBuildRepository.update(
      { requestId: build.requestId },
      {
        status: data.status as NexusBuild['status'],
        files: data.files ? JSON.stringify(data.files) : undefined,
        message: data.message ?? undefined,
      },
    );

    // 构建完成后下载产物
    if (data.status === 'completed' && data.files?.length) {
      await this.downloadBuildFilesToLocal(
        nexusToken.nexusToken,
        build.requestId,
        data.files,
      );
    }

    // 终态时清除 currentRequestId
    if (['completed', 'failed', 'cancelled'].includes(data.status)) {
      if (nexusToken.currentRequestId === build.requestId) {
        nexusToken.currentRequestId = null as unknown as string;
        await this.nexusTokenRepository.save(nexusToken);
      }
    }
  }

  /**
   * 获取本地存储路径
   */
  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * 创建 Nexus 登录会话
   */
  async createLoginSession(userGuid: string, installId: string): Promise<NexusLoginResponse> {
    const response = await this.fetchNexus(
      `/v1/auth/github/login?install_id=${encodeURIComponent(installId)}`,
      { method: 'GET' },
    );

    if (!response.ok) {
      this.logger.error(
        `Failed to create Nexus login session: ${response.status} ${await response.text()}`,
      );
      throw new InternalServerErrorException('创建 Nexus 登录会话失败');
    }

    const data = (await response.json()) as NexusLoginResponse;

    this.loginSessionMap.set(data.login_id, userGuid);

    setTimeout(
      () => this.loginSessionMap.delete(data.login_id),
      data.expires_in * 1000,
    );

    return data;
  }

  /**
   * 轮询 Nexus 登录状态
   */
  async pollLoginStatus(
    loginId: string,
  ): Promise<NexusAuthStatusResponse> {
    const response = await this.fetchNexus(
      `/v1/auth/github/status?login_id=${encodeURIComponent(loginId)}`,
      { method: 'GET' },
    );

    if (response.status === 404) {
      return { state: 'failed', error: '登录会话已过期' };
    }

    if (!response.ok) {
      this.logger.error(
        `Nexus login status poll failed: ${response.status}`,
      );
      return { state: 'failed', error: '查询登录状态失败' };
    }

    const data = (await response.json()) as {
      state: string;
      token?: string;
      username?: string;
      expires_in?: number;
      error?: string;
    };

    if (data.state === 'completed' && data.token && data.username) {
      const userGuid = this.loginSessionMap.get(loginId);
      if (userGuid) {
        await this.saveNexusToken(
          userGuid,
          data.token,
          data.username,
          data.expires_in ?? 2592000,
        );
        this.loginSessionMap.delete(loginId);
      }

      return {
        state: 'completed',
        nexus_username: data.username,
        expires_in: data.expires_in,
      };
    }

    if (data.state === 'failed') {
      this.loginSessionMap.delete(loginId);
      return {
        state: 'failed',
        error: data.error ?? '登录失败',
      };
    }

    return { state: 'pending' };
  }

  /**
   * 查询当前用户的 Nexus 绑定状态
   */
  async getBindStatus(userGuid: string): Promise<NexusBindStatusResponse> {
    const nexusToken = await this.nexusTokenRepository.findOne({
      where: { userGuid },
    });

    if (!nexusToken) {
      return { bound: false };
    }

    if (nexusToken.isExpired()) {
      return { bound: false, expired: true, nexus_username: nexusToken.nexusUsername };
    }

    return { bound: true, nexus_username: nexusToken.nexusUsername };
  }

  /**
   * 解绑 Nexus（删除 Token）
   */
  async unbind(userGuid: string): Promise<void> {
    await this.nexusTokenRepository.delete({ userGuid });
  }

  /**
   * 提交构建请求
   */
  async submitBuild(
    userGuid: string,
    dto: NexusGenerateDto,
  ): Promise<NexusGenerateResponse> {
    const nexusToken = await this.getValidNexusToken(userGuid);

    const response = await this.fetchNexus('/v1/client/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nexusToken.nexusToken}`,
      },
      body: JSON.stringify(dto),
    });

    if (response.status === 401) {
      throw new UnauthorizedException('Nexus Token 已过期，请重新绑定');
    }

    if (response.status === 403) {
      throw new ForbiddenException(
        '请先对 databk/rustdesk-console 仓库进行 Star、Fork 或 Watch 操作',
      );
    }

    if (response.status === 409) {
      throw new ConflictException('已有一个正在进行的构建任务');
    }

    if (response.status === 429) {
      throw new ConflictException('本月生成次数已达上限（15 次/月）');
    }

    if (response.status === 400) {
      const msg = await response.text();
      throw new BadRequestException(msg || '请求参数无效');
    }

    if (!response.ok) {
      this.logger.error(
        `Nexus build submit failed: ${response.status} ${await response.text()}`,
      );
      throw new InternalServerErrorException('提交构建请求失败');
    }

    const data = (await response.json()) as NexusGenerateResponse;

    nexusToken.currentRequestId = data.request_id;
    await this.nexusTokenRepository.save(nexusToken);

    // 持久化构建记录
    const build = this.nexusBuildRepository.create({
      requestId: data.request_id,
      userGuid,
      os: dto.os,
      arch: dto.arch,
      appName: dto.custom?.['app-name'] ?? '',
      custom: JSON.stringify(dto.custom),
      status: 'pending',
    });
    await this.nexusBuildRepository.save(build);

    return data;
  }

  /**
   * 获取当前用户的所有构建记录
   */
  async listBuilds(userGuid: string): Promise<NexusBuild[]> {
    return this.nexusBuildRepository.find({
      where: { userGuid },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 删除构建记录
   */
  async deleteBuild(userGuid: string, requestId: string): Promise<void> {
    const build = await this.nexusBuildRepository.findOne({
      where: { requestId, userGuid },
    });
    if (!build) {
      throw new BadRequestException('构建记录不存在');
    }
    if (build.status === 'pending' || build.status === 'building') {
      throw new BadRequestException('进行中的构建任务不能删除');
    }
    await this.nexusBuildRepository.delete({ requestId });
  }

  /**
   * 列出构建产物的文件列表（从本地目录读取）
   */
  async listBuildFiles(requestId: string): Promise<string[]> {
    return this.getLocalFiles(requestId);
  }

  /**
   * 获取本地文件路径，用于下载
   */
  getLocalFilePath(requestId: string, filename: string): string {
    return join(this.storagePath, requestId, filename);
  }

  /**
   * 将构建产物从 Nexus 下载到本地存储
   */
  private async downloadBuildFilesToLocal(
    nexusToken: string,
    requestId: string,
    files: string[],
  ): Promise<void> {
    if (this.downloadingSet.has(requestId)) {
      return;
    }
    this.downloadingSet.add(requestId);

    const dir = join(this.storagePath, requestId);
    mkdirSync(dir, { recursive: true });

    try {
      for (const file of files) {
        const filePath = join(dir, file);
        if (existsSync(filePath)) {
          continue;
        }

        this.logger.log(`Downloading build artifact: ${requestId}/${file}`);

        const response = await this.fetchNexus(
          `/v1/client/download/${encodeURIComponent(requestId)}/${encodeURIComponent(file)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${nexusToken}`,
            },
          },
        );

        if (!response.ok) {
          this.logger.error(
            `Failed to download ${file}: ${response.status} ${await response.text()}`,
          );
          throw new InternalServerErrorException(
            `下载构建产物 ${file} 失败`,
          );
        }

        const writeStream = createWriteStream(filePath);
        if (!response.body) {
          throw new InternalServerErrorException(`下载构建产物 ${file} 失败：响应体为空`);
        }
        const reader = response.body.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            writeStream.write(value);
          }
          writeStream.end();
          await new Promise<void>((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });
        } catch (err) {
          writeStream.destroy();
          throw err;
        }
      }

      this.logger.log(`All build artifacts downloaded: ${requestId}`);
    } finally {
      this.downloadingSet.delete(requestId);
    }
  }

  /**
   * 从本地目录读取文件列表
   */
  private getLocalFiles(requestId: string): string[] {
    const dir = join(this.storagePath, requestId);
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir).filter((f) => {
      try {
        return !createReadStream(join(dir, f)).destroyed;
      } catch {
        return false;
      }
    });
  }

  /**
   * 获取用户有效的 Nexus Token，过期则抛出异常
   */
  private async getValidNexusToken(userGuid: string): Promise<NexusToken> {
    const nexusToken = await this.nexusTokenRepository.findOne({
      where: { userGuid },
    });

    if (!nexusToken) {
      throw new UnauthorizedException('请先绑定 Nexus 账号');
    }

    if (nexusToken.isExpired()) {
      throw new UnauthorizedException('Nexus Token 已过期，请重新绑定');
    }

    return nexusToken;
  }

  /**
   * 保存或更新 Nexus Token
   */
  private async saveNexusToken(
    userGuid: string,
    token: string,
    username: string,
    expiresIn: number,
  ): Promise<void> {
    let nexusToken = await this.nexusTokenRepository.findOne({
      where: { userGuid },
    });

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn);

    if (nexusToken) {
      nexusToken.nexusToken = token;
      nexusToken.nexusUsername = username;
      nexusToken.expiresAt = expiresAt;
    } else {
      nexusToken = this.nexusTokenRepository.create({
        userGuid,
        nexusToken: token,
        nexusUsername: username,
        expiresAt,
      });
    }

    await this.nexusTokenRepository.save(nexusToken);
  }

  /**
   * 封装 Nexus API 请求
   */
  private async fetchNexus(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.configService.get<string>('NEXUS_BASE_URL', NEXUS_BASE_URL)}${path}`;
    return fetch(url, options);
  }
}
