import { businessWritesAllowed } from '../../updater/maintenance';
import {
  Injectable,
  Logger,
  BadRequestException,
  BadGatewayException,
  UnauthorizedException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, timingSafeEqual } from 'crypto';
import {
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  statSync,
} from 'fs';
import { resolve, relative } from 'path';
import { getCustomClientStoragePath } from '../../common/utils/data-dir.util';
import { CustomClientBuild } from './entities/custom-client-build.entity';
import { CustomClientSettingsService } from './services/custom-client-settings.service';
import { GeneralSettingsService } from '../settings/services/general-settings.service';
import {
  SubmitBuildDto,
  SubmitBuildResponse,
  BuildProgressResponse,
} from './dto/custom-client-build.dto';

const GITHUB_API = 'https://api.github.com';
const CALLBACK_TIMEOUT_MS = 10_000;
const ALLOWED_CALLBACK_STATUSES: CustomClientBuild['status'][] = [
  'building',
  'completed',
  'failed',
];

interface GithubDispatchInputs {
  'build-id': string;
  'callback-url': string;
  'callback-token': string;
  'custom-json': string;
}

function resolveWorkflowFile(os: string, arch: string | undefined): string {
  if (os === 'all') {
    return 'flutter-build.yml';
  }
  if (!arch) {
    throw new BadRequestException(
      'arch is required for single-platform builds',
    );
  }
  const key = `${os}/${arch}`;
  const map: Record<string, string> = {
    'windows/x86_64': 'windows-x86_64.yml',
    'windows/x86': 'windows-x86.yml',
    'windows/aarch64': 'windows-aarch64.yml',
    'linux/x86_64': 'linux-x86_64.yml',
    'linux/aarch64': 'linux-aarch64.yml',
    'linux/armv7': 'linux-armv7.yml',
    'macos/x86_64': 'macos-x86_64.yml',
    'macos/aarch64': 'macos-aarch64.yml',
    'android/aarch64': 'android-aarch64.yml',
    'android/armv7': 'android-armv7.yml',
    'android/x86_64': 'android-x86_64.yml',
    'ios/aarch64': 'ios-aarch64.yml',
  };
  const file = map[key];
  if (!file) {
    throw new BadRequestException(`Unsupported target: ${key}`);
  }
  return file;
}

@Injectable()
export class CustomClientService {
  private readonly logger = new Logger(CustomClientService.name);
  private readonly storagePath: string;

  constructor(
    @InjectRepository(CustomClientBuild)
    private buildRepository: Repository<CustomClientBuild>,
    private readonly settingsService: CustomClientSettingsService,
    private readonly generalSettingsService: GeneralSettingsService,
  ) {
    this.storagePath = getCustomClientStoragePath();
  }

  async submitBuild(
    userGuid: string,
    dto: SubmitBuildDto,
  ): Promise<SubmitBuildResponse> {
    if (!businessWritesAllowed()) {
      throw new BadRequestException(
        'Server is in maintenance mode, builds cannot be submitted',
      );
    }

    const settings = await this.settingsService.getActiveSettings();
    if (!settings.githubToken) {
      throw new BadRequestException(
        'GitHub token is not configured, please configure it in custom-client settings first',
      );
    }

    const site = await this.generalSettingsService.getSiteSettings();
    const callbackUrl = `${site.effectiveBackendUrl}/api/custom-client/builds/{uuid}/callback`;

    const uuid = randomUUID();
    const callbackToken = randomUUID();
    const callbackUrlResolved = callbackUrl.replace('{uuid}', uuid);

    const workflowFile = resolveWorkflowFile(dto.os, dto.arch);
    const inputs: GithubDispatchInputs = {
      'build-id': uuid,
      'callback-url': callbackUrlResolved,
      'callback-token': callbackToken,
      'custom-json': dto.custom ? JSON.stringify(dto.custom) : '',
    };

    const dispatchUrl = `${GITHUB_API}/repos/${settings.generatorRepo}/actions/workflows/${workflowFile}/dispatches`;
    const response = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({ ref: settings.generatorRef, inputs }),
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      throw new BadGatewayException(
        'GitHub token is invalid or lacks workflow permission',
      );
    }
    if (response.status === 404) {
      throw new NotFoundException(
        `Workflow or repository not found: ${settings.generatorRepo}`,
      );
    }
    if (response.status === 422) {
      const body = await response.text();
      throw new BadRequestException(
        `GitHub rejected the dispatch request: ${body}`,
      );
    }
    if (!response.ok) {
      this.logger.error(
        `GitHub dispatch failed: ${response.status} ${await response.text()}`,
      );
      throw new InternalServerErrorException(
        'Failed to trigger build workflow',
      );
    }

    const dispatchBody = (await response.json()) as {
      workflow_run_id?: number;
    };
    const githubRunId = dispatchBody.workflow_run_id
      ? String(dispatchBody.workflow_run_id)
      : undefined;

    const build = this.buildRepository.create({
      uuid,
      userGuid,
      os: dto.os,
      arch: dto.os === 'all' ? 'all' : (dto.arch ?? ''),
      custom: dto.custom ? JSON.stringify(dto.custom) : undefined,
      status: 'pending',
      callbackToken,
      githubRunId,
    });
    await this.buildRepository.save(build);

    return { uuid, status: 'pending', message: 'Build submitted' };
  }

  async listBuilds(userGuid: string): Promise<CustomClientBuild[]> {
    return this.buildRepository.find({
      where: { userGuid },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteBuild(userGuid: string, uuid: string): Promise<void> {
    const build = await this.buildRepository.findOne({
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
    await this.buildRepository.delete({ uuid });
    rmSync(this.safeJoin(uuid), { recursive: true, force: true });
  }

  async listBuildFiles(uuid: string, userGuid: string): Promise<string[]> {
    await this.findOwnedBuild(uuid, userGuid);
    const dir = this.safeJoin(uuid);
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(this.safeJoin(uuid, f)).isFile();
      } catch {
        return false;
      }
    });
  }

  async getLocalFilePath(
    uuid: string,
    filename: string,
    userGuid: string,
  ): Promise<string> {
    await this.findOwnedBuild(uuid, userGuid);
    return this.safeJoin(uuid, filename);
  }

  async handleCallback(
    uuid: string,
    callbackToken: string,
    status: string,
    message: string | undefined,
    files: Express.Multer.File[],
  ): Promise<void> {
    const build = await this.buildRepository.findOne({ where: { uuid } });
    if (!build) {
      throw new NotFoundException('Build record not found');
    }
    if (
      build.callbackToken.length !== callbackToken.length ||
      !timingSafeEqual(
        Buffer.from(build.callbackToken),
        Buffer.from(callbackToken),
      )
    ) {
      throw new UnauthorizedException('Invalid callback token');
    }
    if (
      !ALLOWED_CALLBACK_STATUSES.includes(status as CustomClientBuild['status'])
    ) {
      throw new BadRequestException('Invalid status');
    }
    if (build.status === 'completed' || build.status === 'failed') {
      throw new BadRequestException('Build already finished');
    }

    const savedNames: string[] = [];
    if (files && files.length > 0) {
      const dir = this.safeJoin(uuid);
      mkdirSync(dir, { recursive: true });
      for (const file of files) {
        const target = this.safeJoin(uuid, file.originalname);
        writeFileSync(target, file.buffer);
        savedNames.push(file.originalname);
      }
    }

    await this.buildRepository.update(
      { uuid },
      {
        status: status as CustomClientBuild['status'],
        message: message ?? undefined,
        files: savedNames.length > 0 ? JSON.stringify(savedNames) : undefined,
        callbackToken: randomUUID(),
      },
    );

    this.logger.log(`Callback processed for build ${uuid}: ${status}`);
  }

  async getBuildProgress(
    uuid: string,
    userGuid: string,
  ): Promise<BuildProgressResponse> {
    const build = await this.findOwnedBuild(uuid, userGuid);

    if (!build.githubRunId) {
      return {
        runId: null,
        runStatus: 'queued',
        runConclusion: null,
        jobs: [],
      };
    }

    const settings = await this.settingsService.getActiveSettings();
    if (!settings.githubToken) {
      throw new BadRequestException('GitHub token is not configured');
    }

    const runId = build.githubRunId;
    const repo = settings.generatorRepo;

    const [runData, jobsData] = await Promise.all([
      this.githubFetch<{ status: string; conclusion: string | null }>(
        `${GITHUB_API}/repos/${repo}/actions/runs/${runId}`,
        settings.githubToken,
      ),
      this.githubFetch<{
        jobs: Array<{
          name: string;
          status: string;
          conclusion: string | null;
          steps: Array<{
            name: string;
            status: string;
            conclusion: string | null;
          }>;
        }>;
      }>(
        `${GITHUB_API}/repos/${repo}/actions/runs/${runId}/jobs`,
        settings.githubToken,
      ),
    ]);

    return {
      runId,
      runStatus: runData.status,
      runConclusion: runData.conclusion,
      jobs: jobsData.jobs.map((job) => ({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        steps: job.steps.map((step) => ({
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
        })),
      })),
    };
  }

  private async findOwnedBuild(
    uuid: string,
    userGuid: string,
  ): Promise<CustomClientBuild> {
    const build = await this.buildRepository.findOne({
      where: { uuid, userGuid },
    });
    if (!build) {
      throw new NotFoundException('Build record not found');
    }
    return build;
  }

  private async githubFetch<T>(url: string, token: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub API ${response.status}: ${await response.text()}`,
      );
    }
    return response.json() as Promise<T>;
  }

  private safeJoin(...segments: string[]): string {
    const target = resolve(this.storagePath, ...segments);
    const rel = relative(this.storagePath, target);
    if (rel.startsWith('..') || resolve(this.storagePath) === target) {
      throw new BadRequestException('Invalid path');
    }
    return target;
  }
}
