import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createReadStream, createWriteStream, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { NexusToken } from './entities/nexus-token.entity';
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

@Injectable()
export class NexusService {
  private readonly logger = new Logger(NexusService.name);
  private readonly storagePath: string;

  /** 内存中暂存 login_id 与 userGuid 的映射，用于轮询成功后关联用户 */
  private loginSessionMap = new Map<string, string>();

  /** 正在下载的 request_id 集合，防止并发重复下载 */
  private downloadingSet = new Set<string>();

  constructor(
    @InjectRepository(NexusToken)
    private nexusTokenRepository: Repository<NexusToken>,
    private configService: ConfigService,
  ) {
    this.storagePath = this.configService.get<string>(
      'NEXUS_STORAGE_PATH',
      DEFAULT_STORAGE_PATH,
    );
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
  async createLoginSession(userGuid: string): Promise<NexusLoginResponse> {
    const response = await this.fetchNexus('/v1/auth/github/login', {
      method: 'GET',
    });

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

    return data;
  }

  /**
   * 查询构建状态
   * 构建完成后自动将产物下载到本地
   */
  async getBuildStatus(userGuid: string): Promise<NexusBuildStatusResponse> {
    const nexusToken = await this.getValidNexusToken(userGuid);

    if (!nexusToken.currentRequestId) {
      throw new BadRequestException('当前没有构建任务');
    }

    // 如果文件已下载到本地，直接从本地返回终态
    const localFiles = this.getLocalFiles(nexusToken.currentRequestId);
    if (localFiles.length > 0) {
      return {
        request_id: nexusToken.currentRequestId,
        status: 'completed',
        files: localFiles,
      };
    }

    const response = await this.fetchNexus(
      `/v1/client/generate/${encodeURIComponent(nexusToken.currentRequestId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${nexusToken.nexusToken}`,
        },
      },
    );

    if (response.status === 401) {
      throw new UnauthorizedException('Nexus Token 已过期，请重新绑定');
    }

    if (!response.ok) {
      this.logger.error(
        `Nexus build status query failed: ${response.status}`,
      );
      throw new InternalServerErrorException('查询构建状态失败');
    }

    const data = (await response.json()) as NexusBuildStatusResponse;

    // 构建完成后，将产物下载到本地
    if (data.status === 'completed' && data.files?.length) {
      await this.downloadBuildFilesToLocal(
        nexusToken.nexusToken,
        nexusToken.currentRequestId,
        data.files,
      );
      // 下载完成后清除 currentRequestId
      nexusToken.currentRequestId = null as unknown as string;
      await this.nexusTokenRepository.save(nexusToken);
    } else if (['failed', 'cancelled'].includes(data.status)) {
      nexusToken.currentRequestId = null as unknown as string;
      await this.nexusTokenRepository.save(nexusToken);
    }

    return data;
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
