import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CustomClientBuild } from '../entities/custom-client-build.entity';
import { CustomClientSettingsService } from './custom-client-settings.service';

const GITHUB_API = 'https://api.github.com';
const SYNC_INTERVAL_MS = 60_000;
const CALLBACK_TIMEOUT_MS = 10_000;

const TERMINAL_STATUSES: CustomClientBuild['status'][] = [
  'completed',
  'failed',
  'cancelled',
  'skipped',
  'timed_out',
  'neutral',
  'action_required',
];

const CONCLUSION_TO_STATUS: Record<string, CustomClientBuild['status']> = {
  success: 'completed',
  failure: 'failed',
  cancelled: 'cancelled',
  skipped: 'skipped',
  timed_out: 'timed_out',
  neutral: 'neutral',
  action_required: 'action_required',
  stale: 'failed',
};

@Injectable()
export class BuildStatusSyncService {
  private readonly logger = new Logger(BuildStatusSyncService.name);

  constructor(
    @InjectRepository(CustomClientBuild)
    private buildRepository: Repository<CustomClientBuild>,
    private settingsService: CustomClientSettingsService,
  ) {}

  @Interval(SYNC_INTERVAL_MS)
  async syncPendingBuilds(): Promise<void> {
    try {
      const builds = await this.buildRepository.find({
        where: { status: In(['pending', 'building']) },
      });

      if (builds.length === 0) return;

      this.logger.debug(`Syncing ${builds.length} active build(s)`);

      const settings = await this.settingsService.getActiveSettings();
      if (!settings.githubToken) return;

      for (const build of builds) {
        if (!build.githubRunId) continue;
        await this.syncSingleBuild(
          build,
          settings.githubToken,
          settings.generatorRepo,
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Build status sync failed: ${msg}`);
    }
  }

  async syncSingleBuild(
    build: CustomClientBuild,
    githubToken: string,
    repo: string,
  ): Promise<void> {
    try {
      const runData = await this.githubFetch<{
        status: string;
        conclusion: string | null;
      }>(
        `${GITHUB_API}/repos/${repo}/actions/runs/${build.githubRunId}`,
        githubToken,
      );

      if (
        runData.status === 'completed' &&
        !TERMINAL_STATUSES.includes(build.status)
      ) {
        const newStatus =
          CONCLUSION_TO_STATUS[runData.conclusion ?? 'failure'] ?? 'failed';
        await this.buildRepository.update(
          { uuid: build.uuid },
          { status: newStatus },
        );
        this.logger.log(
          `Build ${build.uuid} status auto-updated to ${newStatus} via sync`,
        );
      } else if (
        runData.status === 'in_progress' &&
        build.status === 'pending'
      ) {
        await this.buildRepository.update(
          { uuid: build.uuid, status: 'pending' },
          { status: 'building' },
        );
        this.logger.log(
          `Build ${build.uuid} status auto-updated to building via sync`,
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to sync build ${build.uuid}: ${msg}`);
    }
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
}
