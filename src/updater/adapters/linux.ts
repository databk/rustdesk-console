import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Blocker,
  DeploymentAdapter,
  Installation,
  JobRecord,
  PersistedPlan,
} from '../contracts';
import { assert, safeError } from '../errors';
import {
  atomicWrite,
  CommandRunner,
  digest,
  missing,
  readJson,
  runCommand,
  syncDirectory,
} from '../io';
import { installationPath } from '../installation';
import { FetchBytes, officialFetch } from '../catalog';
import { UpdateStore, UUID } from '../store';
import {
  canonical,
  commitInstallation,
  fileHashes,
  HealthReader,
  readHealth,
  verifyHealth,
  verifyHelper,
} from './common';
import { checkReleaseSpace, extractArchive } from './archive';
export class LinuxDeployment implements DeploymentAdapter {
  private readonly settings: NonNullable<Installation['linux']>;
  constructor(
    private readonly installation: Installation,
    private readonly command: CommandRunner = runCommand,
    private readonly download: FetchBytes = officialFetch,
    private readonly health: HealthReader = readHealth,
  ) {
    assert(
      installation.linux,
      'LINUX_LAYOUT_UNSUPPORTED',
      'The managed Linux record is missing.',
    );
    this.settings = installation.linux;
  }
  private async systemctl(args: string[]): Promise<string> {
    return (await this.command('systemctl', args)).stdout.trim();
  }
  private release(component: 'backend' | 'web', version: string): string {
    return join(this.settings.releasesDir, component, version);
  }
  private async metadata(
    directory: string,
    version: string,
    sourceCommit: string,
  ): Promise<void> {
    const metadata = await readJson<{ version: string; sourceCommit: string }>(
      join(directory, 'release-metadata.json'),
    );
    assert(
      metadata.version === version && metadata.sourceCommit === sourceCommit,
      'BUNDLE_VERSION_MISMATCH',
      'The complete release bundle has inconsistent build metadata.',
    );
  }
  async fingerprint(): Promise<string> {
    await fileHashes(this.settings.configFiles);
    const links = {
      backend: await fs.realpath(this.settings.backendLink),
      web: await fs.realpath(this.settings.webLink),
      updater: await fs.realpath(this.settings.updaterLink),
    };
    for (const component of ['backend', 'web'] as const)
      assert(
        links[component] ===
          this.release(component, this.installation.current[component].version),
        'INSTALLATION_DRIFT',
        'The current release link changed.',
      );
    assert(
      links.updater === links.backend,
      'INSTALLATION_DRIFT',
      'The updater release does not match the recorded backend.',
    );
    const units: Record<string, string> = {};
    for (const unit of Object.values(this.settings.units))
      units[unit] = await this.systemctl(['cat', unit]);
    return digest(canonical({ installation: this.installation, links, units }));
  }
  async preflight(): Promise<Blocker[]> {
    try {
      await this.fingerprint();
      await this.systemctl([
        'is-active',
        this.settings.units.backend,
        this.settings.units.web,
        this.settings.units.updater,
      ]);
      for (const component of ['backend', 'web'] as const) {
        const current = this.installation.current[component];
        const directory = this.release(component, current.version);
        await this.metadata(directory, current.version, current.sourceCommit);
        const unit = await this.systemctl([
          'show',
          '--property=MainPID',
          '--value',
          this.settings.units[component],
        ]);
        assert(
          /^\d+$/.test(unit) && Number(unit) > 0,
          'LINUX_SERVICE_UNKNOWN',
          'The managed service process cannot be identified.',
        );
        const executable = await fs.realpath(`/proc/${unit}/exe`);
        assert(
          executable ===
            join(directory, this.settings.executableRelativePath[component]),
          'LINUX_SERVICE_DRIFT',
          'The managed service is not running its recorded immutable executable.',
        );
      }
      await checkReleaseSpace(this.settings.releasesDir);
      return [];
    } catch (error: unknown) {
      return [safeError(error).blocker()];
    }
  }
  async prepare(plan: PersistedPlan): Promise<void> {
    await this.fingerprint();
    for (const change of plan.view.components.filter(
      (component) => component.action === 'update',
    )) {
      const target = plan.targets[change.component];
      const path = this.release(change.component, target.version);
      try {
        await fs.access(path);
        await this.metadata(path, target.version, target.sourceCommit);
        const proof = await readJson<{ sha256: string }>(
          join(path, '.updater-integrity.json'),
        );
        assert(
          proof.sha256 === target.artifact.sha256,
          'BUNDLE_DIGEST_MISMATCH',
          'An existing release directory has an unverified digest.',
        );
        continue;
      } catch (error: unknown) {
        if (!missing(error)) throw error;
      }
      assert(
        target.artifact.size <= 512 * 1024 * 1024,
        'ARTIFACT_TOO_LARGE',
        'The release bundle exceeds the supported size.',
      );
      const archive = await this.download(
        target.artifact.url,
        512 * 1024 * 1024,
      );
      assert(
        archive.length === target.artifact.size &&
          digest(archive) === target.artifact.sha256,
        'ARTIFACT_DIGEST_MISMATCH',
        'The release archive did not match its official integrity metadata.',
      );
      const staging = `${path}.staging.${randomUUID()}`;
      await fs.mkdir(dirname(staging), { recursive: true, mode: 0o755 });
      await fs.mkdir(staging, { mode: 0o755 });
      try {
        await extractArchive(archive, staging);
        await this.metadata(staging, target.version, target.sourceCommit);
        const executable = join(
          staging,
          this.settings.executableRelativePath[change.component],
        );
        const info = await fs.lstat(executable);
        assert(
          info.isFile() && (info.mode & 0o111) !== 0,
          'BUNDLE_INCOMPLETE',
          'The complete release executable is missing.',
        );
        await atomicWrite(join(staging, '.updater-integrity.json'), {
          sha256: target.artifact.sha256,
        });
        await fs.rename(staging, path);
      } catch (error: unknown) {
        try {
          // 仅回收本次创建且尚未发布的临时目录，不触碰旧版本、其他任务或恢复快照。
          await fs.rm(staging, { recursive: true, force: true });
        } catch {
          // 清理是尽力而为；失败时保留临时目录，并向任务返回原始校验/写入错误。
        }
        throw error;
      }
      await syncDirectory(dirname(path));
    }
  }
  async stopApplications(): Promise<void> {
    await this.systemctl([
      'stop',
      this.settings.units.backend,
      this.settings.units.web,
    ]);
    for (const unit of [this.settings.units.backend, this.settings.units.web]) {
      const state = await this.systemctl([
        'show',
        '--property=MainPID',
        '--value',
        unit,
      ]);
      assert(
        state === '0',
        'SERVICES_STILL_WRITING',
        'A business service has not stopped.',
      );
    }
  }
  private async link(path: string, target: string): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`;
    await fs.symlink(target, temp, 'dir');
    await fs.rename(temp, path);
    await syncDirectory(dirname(path));
  }
  async switchApplications(plan: PersistedPlan): Promise<void> {
    for (const change of plan.view.components.filter(
      (component) => component.action === 'update',
    ))
      await this.link(
        change.component === 'backend'
          ? this.settings.backendLink
          : this.settings.webLink,
        this.release(change.component, change.target),
      );
  }
  async startApplications(): Promise<void> {
    await this.systemctl([
      'start',
      this.settings.units.backend,
      this.settings.units.web,
    ]);
  }
  async verify(plan: PersistedPlan, restored = false): Promise<void> {
    const targets = restored ? this.installation.current : plan.targets;
    for (const component of ['backend', 'web'] as const) {
      const directory = await fs.realpath(
        component === 'backend'
          ? this.settings.backendLink
          : this.settings.webLink,
      );
      assert(
        directory === this.release(component, targets[component].version),
        'BUNDLE_VERSION_MISMATCH',
        'The running release link is not the verified target.',
      );
      const pid = await this.systemctl([
        'show',
        '--property=MainPID',
        '--value',
        this.settings.units[component],
      ]);
      assert(
        /^\d+$/.test(pid) &&
          Number(pid) > 0 &&
          (await fs.realpath(`/proc/${pid}/exe`)) ===
            join(directory, this.settings.executableRelativePath[component]),
        'LINUX_SERVICE_DRIFT',
        'The active service process does not match the expected executable.',
      );
    }
    await verifyHealth(this.installation, targets, this.health);
  }
  async updateHelper(plan: PersistedPlan): Promise<void> {
    if (
      plan.view.components.some(
        (component) =>
          component.component === 'backend' && component.action === 'update',
      )
    ) {
      await this.link(
        this.settings.updaterLink,
        this.release('backend', plan.targets.backend.version),
      );
      await this.systemctl(['restart', this.settings.units.updater]);
    }
    await verifyHelper(this.installation, plan.targets.backend);
  }
  async restoreDeployment(record: JobRecord): Promise<void> {
    for (const component of ['backend', 'web'] as const)
      await this.link(
        component === 'backend'
          ? this.settings.backendLink
          : this.settings.webLink,
        this.release(
          component,
          record.originalInstallation.current[component].version,
        ),
      );
    await this.link(
      this.settings.updaterLink,
      this.release(
        'backend',
        record.originalInstallation.current.backend.version,
      ),
    );
    await atomicWrite(installationPath(), record.originalInstallation);
    await this.systemctl(['restart', this.settings.units.updater]);
    await verifyHelper(this.installation);
  }
  async commit(plan: PersistedPlan): Promise<void> {
    await fileHashes(this.settings.configFiles);
    await commitInstallation(this.installation, plan);
  }
  private unit(jobId: string): string {
    assert(
      UUID.test(jobId),
      'INVALID_ID',
      'The update task identifier is invalid.',
    );
    return this.settings.units.job.replace('@.', `@${jobId}.`);
  }
  async workerAlive(jobId: string): Promise<boolean> {
    const state = await this.systemctl([
      'show',
      '--property=ActiveState',
      '--value',
      this.unit(jobId),
    ]);
    return ['active', 'activating', 'reloading'].includes(state);
  }
  async startWorker(jobId: string): Promise<void> {
    const record = await new UpdateStore(this.installation.stateDir).job(jobId);
    const original = record.originalInstallation;
    const directory = join(this.installation.stateDir, 'workers', jobId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const worker = join(directory, 'worker');
    const executable = resolve(
      join(
        original.linux!.releasesDir,
        'backend',
        original.current.backend.version,
      ),
      original.linux!.executableRelativePath.backend,
    );
    try {
      await fs.symlink(executable, worker);
    } catch (error: unknown) {
      if (!(
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error;
      assert(
        (await fs.realpath(worker)) === executable,
        'WORKER_IDENTITY_CHANGED',
        'The immutable worker executable changed.',
      );
    }
    await syncDirectory(directory);
    await this.systemctl(['enable', '--now', this.unit(jobId)]);
  }
}
