import { posix } from 'node:path';
import {
  Blocker,
  DeploymentAdapter,
  Installation,
  JobRecord,
  PersistedPlan,
} from '../contracts';
import { assert, safeError } from '../errors';
import { atomicWrite, CommandRunner, digest, runCommand } from '../io';
import { installationPath } from '../installation';
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
export interface ComposeServiceConfig {
  image?: string;
  build?: unknown;
  privileged?: boolean;
  profiles?: unknown[];
  environment?: Record<string, string | number | boolean | null>;
  volumes?: (
    | string
    | {
        type?: string;
        source?: string;
        target?: string;
        read_only?: boolean;
      }
  )[];
  command?: string | string[];
  entrypoint?: string | string[];
  [key: string]: unknown;
}
export interface ComposeConfig {
  name?: string;
  services: Record<string, ComposeServiceConfig>;
  [key: string]: unknown;
}
export interface ComposeContainerInfo {
  Id: string;
  Image: string;
  State: { Running: boolean };
  Config: {
    Image: string;
    Labels: Record<string, string>;
    Env?: string[];
    Cmd?: string[] | null;
    Entrypoint?: string[] | null;
  };
  Mounts: {
    Type: string;
    Source: string;
    Destination: string;
    RW: boolean;
  }[];
}
type ContainerInfo = ComposeContainerInfo;

/**
 * Compare the live container with the effective Compose definition instead of
 * the version-dependent `com.docker.compose.config-hash` label. Compose itself
 * documents that hash as an implementation detail which changes between
 * releases, so a host using an older Compose (for example Synology Container
 * Manager) cannot be verified with the hash computed by this image.
 */
export function verifyServiceInstance(
  service: ComposeServiceConfig,
  container: ContainerInfo,
): string | null {
  if (service.image && container.Config.Image !== service.image)
    return 'The running service image differs from the Compose configuration.';
  const environment: Record<string, string> = {};
  for (const item of container.Config.Env ?? []) {
    const at = item.indexOf('=');
    if (at < 0) environment[item] = '';
    else environment[item.slice(0, at)] = item.slice(at + 1);
  }
  for (const [name, value] of Object.entries(service.environment ?? {})) {
    if (value === null || value === undefined) continue;
    if (environment[name] !== String(value))
      return 'The running service environment differs from the Compose configuration.';
  }
  for (const volume of service.volumes ?? []) {
    if (typeof volume === 'string' || !volume.target) continue;
    const mount = container.Mounts.find(
      (item) => item.Destination === volume.target,
    );
    if (!mount)
      return 'The running service mounts differ from the Compose configuration.';
    if (volume.type && mount.Type !== volume.type)
      return 'The running service mounts differ from the Compose configuration.';
    if (
      volume.type === 'bind' &&
      volume.source &&
      mount.Source !== volume.source
    )
      return 'The running service mounts differ from the Compose configuration.';
    if (Boolean(volume.read_only) !== !mount.RW)
      return 'The running service mounts differ from the Compose configuration.';
  }
  for (const [configured, actual] of [
    [service.command, container.Config.Cmd],
    [service.entrypoint, container.Config.Entrypoint],
  ] as const) {
    if (!Array.isArray(configured) || configured.length === 0) continue;
    if (
      !actual ||
      actual.length !== configured.length ||
      actual.some((value, index) => value !== configured[index])
    )
      return 'The running service command differs from the Compose configuration.';
  }
  return null;
}

/** Compare a recorded Compose file list, accepting older relative labels. */
export function composeFilesMatch(
  label: string | undefined,
  projectDirectory: string,
  files: string[],
): boolean {
  if (!label) return true;
  const actual = label
    .split(',')
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) =>
      posix.isAbsolute(file)
        ? posix.normalize(file)
        : posix.resolve(projectDirectory, file),
    );
  const expected = files.map((file) => posix.normalize(file));
  return (
    actual.length === expected.length &&
    actual.every((file, index) => file === expected[index])
  );
}
export function configurationFingerprint(
  config: ComposeConfig,
  services: string[],
): string {
  const normalized = structuredClone(config);
  for (const service of services)
    if (normalized.services[service]) delete normalized.services[service].image;
  return digest(canonical(normalized));
}
export class ComposeDeployment implements DeploymentAdapter {
  private readonly settings: NonNullable<Installation['compose']>;
  constructor(
    private readonly installation: Installation,
    private readonly command: CommandRunner = runCommand,
    private readonly health: HealthReader = readHealth,
  ) {
    assert(
      installation.compose,
      'COMPOSE_LAYOUT_UNSUPPORTED',
      'The managed Compose record is missing.',
    );
    this.settings = installation.compose;
  }
  private async compose(args: string[]): Promise<string> {
    const result = await this.command(
      'docker',
      [
        'compose',
        '--project-directory',
        this.settings.projectDirectory,
        '--project-name',
        this.settings.projectName,
        ...this.settings.files.flatMap((file) => ['--file', file]),
        ...args,
      ],
      { cwd: this.settings.projectDirectory, timeout: 300_000 },
    );
    return result.stdout.trim();
  }
  private async config(): Promise<ComposeConfig> {
    return JSON.parse(
      await this.compose(['config', '--format', 'json']),
    ) as ComposeConfig;
  }
  private async container(service: string): Promise<ContainerInfo> {
    const id = await this.compose(['ps', '-a', '-q', service]);
    assert(
      /^[a-f0-9]{12,64}$/.test(id),
      'COMPOSE_INSTANCE_MISSING',
      'Exactly one managed service instance is required.',
    );
    const result = await this.command('docker', ['inspect', id]);
    return (JSON.parse(result.stdout) as ContainerInfo[])[0];
  }
  async fingerprint(): Promise<string> {
    await fileHashes(this.settings.configFiles);
    const config = await this.config();
    const neutral = configurationFingerprint(
      config,
      Object.values(this.settings.services),
    );
    assert(
      neutral === this.settings.configDigest,
      'CONFIGURATION_DRIFT',
      'The effective Compose configuration changed.',
    );
    return digest(
      canonical({ installation: this.installation, effectiveConfig: neutral }),
    );
  }
  async preflight(): Promise<Blocker[]> {
    try {
      await this.fingerprint();
      const info = JSON.parse(
        (await this.command('docker', ['info', '--format', '{{json .}}']))
          .stdout,
      ) as { OSType: string; SecurityOptions?: string[] };
      assert(
        info.OSType === 'linux' &&
          !info.SecurityOptions?.some((value) => value.includes('rootless')) &&
          !process.env.DOCKER_HOST,
        'DOCKER_UNSUPPORTED',
        'The standard updater requires the local rootful Linux Docker daemon.',
      );
      const config = await this.config();
      for (const component of ['backend', 'web', 'updater'] as const) {
        const service = this.settings.services[component];
        assert(
          config.services[service] && !config.services[service].build,
          'COMPOSE_SOURCE_UNSUPPORTED',
          'Source-built Compose services cannot be updated automatically.',
        );
        const container = await this.container(service);
        const labels = container.Config.Labels;
        const workingDirectory =
          labels['com.docker.compose.project.working_dir'];
        assert(
          labels['com.docker.compose.project'] === this.settings.projectName &&
            labels['com.docker.compose.service'] === service &&
            (!workingDirectory ||
              workingDirectory === this.settings.projectDirectory) &&
            composeFilesMatch(
              labels['com.docker.compose.project.config_files'],
              this.settings.projectDirectory,
              this.settings.files,
            ),
          'COMPOSE_INSTANCE_DRIFT',
          'The running Compose instance does not match the recorded installation.',
        );
        const expected =
          this.installation.current[
            component === 'updater' ? 'backend' : component
          ].artifact.url;
        assert(
          container.Config.Image === expected &&
            config.services[service].image === expected &&
            container.State.Running,
          'CURRENT_VERSION_UNKNOWN',
          'The managed running image is not the recorded immutable release.',
        );
        const image = JSON.parse(
          (await this.command('docker', ['image', 'inspect', expected])).stdout,
        ) as { Id: string }[];
        assert(
          image[0]?.Id === container.Image,
          'IMAGE_IDENTITY_MISMATCH',
          'The running container image does not match the pinned official digest.',
        );
        const drift = verifyServiceInstance(
          config.services[service],
          container,
        );
        assert(
          !drift,
          'COMPOSE_INSTANCE_DRIFT',
          drift ??
            'The effective service configuration differs from its running instance.',
        );
        if (component === 'updater')
          for (const mount of this.settings.workerMounts)
            assert(
              container.Mounts.some(
                (actual) =>
                  actual.Type === 'bind' &&
                  actual.Source === mount.source &&
                  actual.Destination === mount.target &&
                  actual.RW === !mount.readOnly,
              ),
              'COMPOSE_PATH_UNRESOLVED',
              'A host path cannot be reconstructed safely inside the update worker.',
            );
      }
      return [];
    } catch (error: unknown) {
      return [safeError(error).blocker()];
    }
  }
  async prepare(plan: PersistedPlan): Promise<void> {
    await this.fingerprint();
    for (const component of plan.view.components.filter(
      (component) => component.action === 'update',
    )) {
      const artifact = plan.targets[component.component].artifact;
      await this.command('docker', ['pull', artifact.url], {
        timeout: 600_000,
      });
      const images = JSON.parse(
        (await this.command('docker', ['image', 'inspect', artifact.url]))
          .stdout,
      ) as { RepoDigests: string[] }[];
      assert(
        images[0]?.RepoDigests.includes(artifact.url),
        'ARTIFACT_DIGEST_MISMATCH',
        'A downloaded image did not verify against its official digest.',
      );
    }
  }
  async stopApplications(): Promise<void> {
    await this.compose([
      'stop',
      '--timeout',
      '60',
      this.settings.services.backend,
      this.settings.services.web,
    ]);
    for (const service of [
      this.settings.services.backend,
      this.settings.services.web,
    ])
      assert(
        !(await this.container(service)).State.Running,
        'SERVICES_STILL_WRITING',
        'A business service is still running; backup cannot begin.',
      );
  }
  private async override(
    targets: Installation['current'],
    updateHelper: boolean,
  ): Promise<void> {
    await atomicWrite(
      this.settings.overrideFile,
      {
        services: {
          [this.settings.services.backend]: {
            image: targets.backend.artifact.url,
          },
          [this.settings.services.web]: { image: targets.web.artifact.url },
          [this.settings.services.updater]: {
            image: updateHelper
              ? targets.backend.artifact.url
              : this.installation.current.backend.artifact.url,
          },
        },
      },
      0o644,
    );
    const config = await this.config();
    assert(
      configurationFingerprint(
        config,
        Object.values(this.settings.services),
      ) === this.settings.configDigest,
      'CONFIGURATION_DRIFT',
      'The update would alter non-image Compose configuration.',
    );
  }
  async switchApplications(plan: PersistedPlan): Promise<void> {
    await this.override(plan.targets, false);
    const changed = plan.view.components
      .filter((component) => component.action === 'update')
      .map((component) => this.settings.services[component.component]);
    if (changed.length)
      await this.compose([
        'up',
        '--no-start',
        '--no-build',
        '--no-deps',
        '--pull',
        'never',
        ...changed,
      ]);
  }
  async startApplications(): Promise<void> {
    await this.compose([
      'start',
      this.settings.services.backend,
      this.settings.services.web,
    ]);
  }
  async verify(plan: PersistedPlan, restored = false): Promise<void> {
    const targets = restored ? this.installation.current : plan.targets;
    for (const component of ['backend', 'web'] as const) {
      const container = await this.container(this.settings.services[component]);
      assert(
        container.Config.Image === targets[component].artifact.url &&
          container.State.Running,
        'IMAGE_IDENTITY_MISMATCH',
        'The running service does not match the expected release.',
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
      await this.override(plan.targets, true);
      await this.compose([
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        '--pull',
        'never',
        this.settings.services.updater,
      ]);
    }
    await verifyHelper(this.installation, plan.targets.backend);
  }
  async restoreDeployment(record: JobRecord): Promise<void> {
    await this.override(record.originalInstallation.current, true);
    const changed = record.plan.view.components
      .filter((component) => component.action === 'update')
      .map((component) => this.settings.services[component.component]);
    if (changed.length)
      await this.compose([
        'up',
        '--no-start',
        '--no-build',
        '--no-deps',
        '--pull',
        'never',
        ...changed,
      ]);
    await atomicWrite(installationPath(), record.originalInstallation);
    await this.compose([
      'up',
      '-d',
      '--no-deps',
      '--no-build',
      '--pull',
      'never',
      this.settings.services.updater,
    ]);
    await verifyHelper(this.installation);
  }
  async commit(plan: PersistedPlan): Promise<void> {
    await fileHashes(this.settings.configFiles);
    const config = await this.config();
    assert(
      configurationFingerprint(
        config,
        Object.values(this.settings.services),
      ) === this.settings.configDigest,
      'CONFIGURATION_DRIFT',
      'The effective configuration changed during updating.',
    );
    await commitInstallation(this.installation, plan);
  }
  private name(jobId: string): string {
    assert(UUID.test(jobId), 'INVALID_ID', 'Invalid update job identifier.');
    return `${this.settings.projectName}-update-${jobId}`;
  }
  async workerAlive(jobId: string): Promise<boolean> {
    const name = this.name(jobId);
    const ids = (
      await this.command('docker', [
        'ps',
        '-a',
        '--filter',
        `name=^/${name}$`,
        '--format',
        '{{.ID}}',
      ])
    ).stdout.trim();
    if (!ids) return false;
    const info = (
      JSON.parse(
        (await this.command('docker', ['inspect', ids])).stdout,
      ) as ContainerInfo[]
    )[0];
    assert(
      info.Config.Labels['io.rustdesk-console.update-job'] === jobId &&
        info.Config.Labels['io.rustdesk-console.installation'] ===
          this.installation.installationId,
      'OWNERSHIP_UNCERTAIN',
      'A worker name is occupied by an unrelated container.',
    );
    return info.State.Running;
  }
  async startWorker(jobId: string): Promise<void> {
    const original = (
      await new UpdateStore(this.installation.stateDir).job(jobId)
    ).originalInstallation;
    const name = this.name(jobId);
    const existing = (
      await this.command('docker', [
        'ps',
        '-a',
        '--filter',
        `name=^/${name}$`,
        '--format',
        '{{.ID}}',
      ])
    ).stdout.trim();
    if (existing) {
      if (!(await this.workerAlive(jobId)))
        await this.command('docker', ['start', existing]);
      return;
    }
    await this.command('docker', [
      'run',
      '-d',
      '--cpus=0.5',
      '--memory=384m',
      '--restart=on-failure',
      '--name',
      name,
      '--network',
      this.settings.workerNetwork,
      '--label',
      `io.rustdesk-console.update-job=${jobId}`,
      '--label',
      `io.rustdesk-console.installation=${this.installation.installationId}`,
      '--mount',
      'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
      ...this.settings.workerMounts.flatMap((mount) => [
        '--mount',
        `type=bind,src=${mount.source},dst=${mount.target}${mount.readOnly ? ',readonly' : ''}`,
      ]),
      '--env',
      `SYSTEM_UPDATE_INSTALLATION=${installationPath()}`,
      '--env',
      `SYSTEM_UPDATE_SOCKET=${process.env.SYSTEM_UPDATE_SOCKET ?? this.installation.ipcDir + '/control.sock'}`,
      '--env',
      `SYSTEM_UPDATE_MAINTENANCE_FILE=${this.installation.maintenanceFile}`,
      original.compose!.workerImage,
      '--system-update-mode=worker',
      `--job-id=${jobId}`,
    ]);
  }
}
