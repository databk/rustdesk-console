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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'fs';
import { resolve, relative } from 'path';
import { getNexusStoragePath } from '../../common/utils/data-dir.util';
import { NexusToken } from './entities/nexus-token.entity';
import { NexusBuild } from './entities/nexus-build.entity';
import { UpdateCheckService } from '../update-check/update-check.service';
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
const POLL_INTERVAL_MS = 10_000;

@Injectable()
export class NexusService implements OnModuleInit {
  private readonly logger = new Logger(NexusService.name);
  private readonly storagePath: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** In-memory mapping of login_id to userGuid, used to link the user after polling succeeds */
  private loginSessionMap = new Map<string, string>();

  /** Set of uuids currently downloading, preventing concurrent duplicate downloads */
  private downloadingSet = new Set<string>();

  constructor(
    @InjectRepository(NexusToken)
    private nexusTokenRepository: Repository<NexusToken>,
    @InjectRepository(NexusBuild)
    private nexusBuildRepository: Repository<NexusBuild>,
    private updateCheckService: UpdateCheckService,
  ) {
    this.storagePath = getNexusStoragePath();
  }

  async onModuleInit() {
    // Start scheduled polling
    this.pollTimer = setInterval(
      () => void this.pollActiveBuilds(),
      POLL_INTERVAL_MS,
    );
    // Run once immediately on start
    await this.pollActiveBuilds();
  }

  /**
   * Periodically poll all in-progress build tasks
   * Queries Nexus every 10 seconds, updates the status, and downloads artifacts
   */
  private async pollActiveBuilds() {
    try {
      const activeBuilds = await this.nexusBuildRepository.find({
        where: [{ status: 'pending' }, { status: 'building' }],
      });

      if (activeBuilds.length === 0) return;

      for (const build of activeBuilds) {
        await this.syncBuildStatus(build);
      }
    } catch (err) {
      this.logger.error(
        `Error polling active builds: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Sync the status of a single build task
   */
  private async syncBuildStatus(build: NexusBuild) {
    const nexusToken = await this.nexusTokenRepository.findOne({
      where: { userGuid: build.userGuid },
    });

    if (!nexusToken || nexusToken.isExpired()) {
      // Nexus token unavailable, mark the task as failed
      await this.nexusBuildRepository.update(
        { uuid: build.uuid },
        { status: 'failed', message: 'Nexus token has expired' },
      );
      return;
    }

    const response = await this.fetchNexus(
      `/v1/client/generate/${encodeURIComponent(build.uuid)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${nexusToken.nexusToken}` },
      },
    );

    if (!response.ok) {
      this.logger.warn(`Poll build ${build.uuid} failed: ${response.status}`);
      return;
    }

    const data = (await response.json()) as NexusBuildStatusResponse;

    // Update the build record
    await this.nexusBuildRepository.update(
      { uuid: build.uuid },
      {
        status: data.status,
        files: data.files ? JSON.stringify(data.files) : undefined,
        message: data.message ?? undefined,
      },
    );

    // Download artifacts after the build completes
    if (data.status === 'completed' && data.files?.length) {
      await this.downloadBuildFilesToLocal(
        nexusToken.nexusToken,
        build.uuid,
        data.files,
      );
    }

    // Clear currentUuid on a terminal state
    if (['completed', 'failed', 'cancelled'].includes(data.status)) {
      if (nexusToken.currentUuid === build.uuid) {
        nexusToken.currentUuid = null as unknown as string;
        await this.nexusTokenRepository.save(nexusToken);
      }
    }
  }

  /**
   * Get the local storage path
   */
  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Safely join storage path with user-provided segments.
   * Throws BadRequestException if the resolved path escapes storagePath.
   */
  private safeJoin(...segments: string[]): string {
    const target = resolve(this.storagePath, ...segments);
    const rel = relative(this.storagePath, target);
    if (rel.startsWith('..') || resolve(this.storagePath) === target) {
      throw new BadRequestException('Invalid path');
    }
    return target;
  }

  /**
   * Create a Nexus login session
   */
  async createLoginSession(userGuid: string): Promise<NexusLoginResponse> {
    const installId = await this.updateCheckService.getInstallId();
    const response = await this.fetchNexus(
      `/v1/auth/github/login?install_id=${encodeURIComponent(installId)}`,
      { method: 'GET' },
    );

    if (!response.ok) {
      this.logger.error(
        `Failed to create Nexus login session: ${response.status} ${await response.text()}`,
      );
      throw new InternalServerErrorException(
        'Failed to create Nexus login session',
      );
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
   * Poll the Nexus login status
   */
  async pollLoginStatus(loginId: string): Promise<NexusAuthStatusResponse> {
    const response = await this.fetchNexus(
      `/v1/auth/github/status?login_id=${encodeURIComponent(loginId)}`,
      { method: 'GET' },
    );

    if (response.status === 404) {
      return { state: 'failed', error: 'Login session has expired' };
    }

    if (!response.ok) {
      this.logger.error(`Nexus login status poll failed: ${response.status}`);
      return { state: 'failed', error: 'Failed to query login status' };
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
        error: data.error ?? 'Login failed',
      };
    }

    return { state: 'pending' };
  }

  /**
   * Query the Nexus binding status of the current user
   */
  async getBindStatus(userGuid: string): Promise<NexusBindStatusResponse> {
    const nexusToken = await this.nexusTokenRepository.findOne({
      where: { userGuid },
    });

    if (!nexusToken) {
      return { bound: false };
    }

    if (nexusToken.isExpired()) {
      return {
        bound: false,
        expired: true,
        nexus_username: nexusToken.nexusUsername,
      };
    }

    return { bound: true, nexus_username: nexusToken.nexusUsername };
  }

  /**
   * Unbind Nexus (delete the token)
   */
  async unbind(userGuid: string): Promise<void> {
    await this.nexusTokenRepository.delete({ userGuid });
  }

  /**
   * Submit a build request
   */
  async submitBuild(
    userGuid: string,
    dto: NexusGenerateDto,
  ): Promise<NexusGenerateResponse> {
    const nexusToken = await this.getValidNexusToken(userGuid);
    const installId = await this.updateCheckService.getInstallId();

    const response = await this.fetchNexus('/v1/client/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nexusToken.nexusToken}`,
      },
      body: JSON.stringify({ ...dto, install_id: installId }),
    });

    if (response.status === 401) {
      throw new UnauthorizedException('Nexus token has expired, please rebind');
    }

    if (response.status === 403) {
      throw new ForbiddenException(
        'Please Star, Fork, or Watch the databk/rustdesk-console repository first',
      );
    }

    if (response.status === 409) {
      throw new ConflictException('A build task is already in progress');
    }

    if (response.status === 429) {
      throw new ConflictException('Monthly build limit reached (15 per month)');
    }

    if (response.status === 400) {
      const msg = await response.text();
      throw new BadRequestException(msg || 'Invalid request parameters');
    }

    if (!response.ok) {
      this.logger.error(
        `Nexus build submit failed: ${response.status} ${await response.text()}`,
      );
      throw new InternalServerErrorException('Failed to submit build request');
    }

    const data = (await response.json()) as NexusGenerateResponse;

    nexusToken.currentUuid = data.uuid;
    await this.nexusTokenRepository.save(nexusToken);

    // Persist the build record
    const build = this.nexusBuildRepository.create({
      uuid: data.uuid,
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
   * Get all build records of the current user
   */
  async listBuilds(userGuid: string): Promise<NexusBuild[]> {
    return this.nexusBuildRepository.find({
      where: { userGuid },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Delete a build record
   */
  async deleteBuild(userGuid: string, uuid: string): Promise<void> {
    const build = await this.nexusBuildRepository.findOne({
      where: { uuid, userGuid },
    });
    if (!build) {
      throw new BadRequestException('Build record not found');
    }
    if (build.status === 'pending' || build.status === 'building') {
      throw new BadRequestException(
        'A build task in progress cannot be deleted',
      );
    }
    await this.nexusBuildRepository.delete({ uuid });
  }

  /**
   * List the build artifact files (read from the local directory)
   */
  listBuildFiles(uuid: string): string[] {
    return this.getLocalFiles(uuid);
  }

  /**
   * Get the local file path for download
   */
  getLocalFilePath(uuid: string, filename: string): string {
    return this.safeJoin(uuid, filename);
  }

  /**
   * Download build artifacts from Nexus to local storage
   */
  private async downloadBuildFilesToLocal(
    nexusToken: string,
    uuid: string,
    files: string[],
  ): Promise<void> {
    if (this.downloadingSet.has(uuid)) {
      return;
    }
    this.downloadingSet.add(uuid);

    const dir = this.safeJoin(uuid);
    mkdirSync(dir, { recursive: true });

    try {
      for (const file of files) {
        const filePath = this.safeJoin(uuid, file);
        if (existsSync(filePath)) {
          continue;
        }

        this.logger.log(`Downloading build artifact: ${uuid}/${file}`);

        const response = await this.fetchNexus(
          `/v1/client/download/${encodeURIComponent(uuid)}/${encodeURIComponent(file)}`,
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
            `Failed to download build artifact ${file}`,
          );
        }

        const writeStream = createWriteStream(filePath);
        if (!response.body) {
          throw new InternalServerErrorException(
            `Failed to download build artifact ${file}: empty response body`,
          );
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

      this.logger.log(`All build artifacts downloaded: ${uuid}`);
    } finally {
      this.downloadingSet.delete(uuid);
    }
  }

  /**
   * Read the file list from the local directory
   */
  private getLocalFiles(uuid: string): string[] {
    const dir = this.safeJoin(uuid);
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir).filter((f) => {
      try {
        return !createReadStream(this.safeJoin(uuid, f)).destroyed;
      } catch {
        return false;
      }
    });
  }

  /**
   * Get the user valid Nexus token; throws an exception if expired
   */
  private async getValidNexusToken(userGuid: string): Promise<NexusToken> {
    const nexusToken = await this.nexusTokenRepository.findOne({
      where: { userGuid },
    });

    if (!nexusToken) {
      throw new UnauthorizedException('Please bind a Nexus account first');
    }

    if (nexusToken.isExpired()) {
      throw new UnauthorizedException('Nexus token has expired, please rebind');
    }

    return nexusToken;
  }

  /**
   * Save or update the Nexus token
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
   * Wrap Nexus API requests
   */
  private async fetchNexus(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${NEXUS_BASE_URL}${path}`;
    return fetch(url, options);
  }
}
