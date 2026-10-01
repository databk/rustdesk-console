import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  BackupAdapter,
  BackupContext,
  Blocker,
  Capabilities,
  DeploymentAdapter,
  Installation,
  PersistedPlan,
  UpdatePlan,
} from './contracts';
import { Catalog } from './catalog';
import { assert, safeError } from './errors';
import { digest } from './io';
import { compareVersions, satisfies, selectArtifact } from './manifest';
import { terminal, UpdateStore } from './store';
export class Planner {
  constructor(
    readonly installation: Installation,
    readonly deployment: DeploymentAdapter,
    readonly backup: BackupAdapter,
    readonly catalog: Catalog,
    readonly store: UpdateStore,
  ) {}
  backupContext(jobId: string, servicesStopped = false): BackupContext {
    return {
      jobId,
      database: this.installation.database,
      dataDir: this.installation.dataDir,
      backupDir: join(this.installation.stateDir, 'backups', jobId),
      servicesStopped,
    };
  }
  async blockers(): Promise<Blocker[]> {
    try {
      return [
        ...(await this.deployment.preflight()),
        ...(await this.backup.preflight(this.backupContext('preflight'))),
      ];
    } catch (error: unknown) {
      return [safeError(error).blocker()];
    }
  }
  async capabilities(): Promise<Capabilities> {
    const blockers = await this.blockers();
    const current = await this.store.current();
    if (current && !terminal(current))
      blockers.push({
        code: 'JOB_ACTIVE',
        message: 'An update or recovery is already active.',
      });
    return {
      protocolVersion: 1,
      installationId: this.installation.installationId,
      supported: true,
      ready: blockers.length === 0,
      deployment: this.installation.deployment,
      database: this.installation.database.kind,
      current: {
        backend: this.installation.current.backend.version,
        web: this.installation.current.web.version,
      },
      blockers,
      activeJobId: current && !terminal(current) ? current.view.jobId : null,
    };
  }
  async create(): Promise<UpdatePlan> {
    const createdAt = new Date();
    const blockers = await this.blockers();
    const targets = structuredClone(this.installation.current);
    for (const component of ['backend', 'web'] as const) {
      try {
        const manifest = await this.catalog.latest(component);
        if (compareVersions(manifest.version, targets[component].version) > 0)
          targets[component] = {
            version: manifest.version,
            sourceCommit: manifest.sourceCommit,
            manifest,
            artifact: selectArtifact(
              manifest,
              this.installation.platform,
              this.installation.deployment === 'managed-compose'
                ? 'oci'
                : 'archive',
            ),
          };
      } catch (error: unknown) {
        blockers.push(safeError(error).blocker());
      }
    }
    if (
      !satisfies(
        targets.web.version,
        targets.backend.manifest.peerVersionRange,
      ) ||
      !satisfies(targets.backend.version, targets.web.manifest.peerVersionRange)
    )
      blockers.push({
        code: 'INCOMPATIBLE_RELEASES',
        message:
          'The latest official frontend and backend releases are not mutually compatible.',
      });
    const components = (['backend', 'web'] as const).map((component) => ({
      component,
      action:
        targets[component].version ===
        this.installation.current[component].version
          ? ('unchanged' as const)
          : ('update' as const),
      current: this.installation.current[component].version,
      target: targets[component].version,
      releaseUrl: `https://github.com/${targets[component].manifest.repository}/releases/tag/${targets[component].manifest.tag}`,
    }));
    const changes = components.some(
      (component) => component.action === 'update',
    );
    const view: UpdatePlan = {
      protocolVersion: 1,
      installationId: this.installation.installationId,
      planId: randomUUID(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
      components,
      changes,
      downtime: changes,
      backup: {
        database: this.installation.database.kind,
        method:
          this.installation.database.kind === 'sqlite'
            ? 'consistent-sqlite-and-business-files'
            : 'dedicated-schema-dump-and-business-files',
        includesBusinessFiles: true,
      },
      blockers,
      executable: changes && blockers.length === 0,
    };
    const plan: PersistedPlan = {
      view,
      targets,
      installationFingerprint: await this.deployment.fingerprint(),
      manifestDigests: {
        backend: digest(targets.backend.manifest),
        web: digest(targets.web.manifest),
      },
    };
    await this.store.savePlan(plan);
    return view;
  }
  async revalidate(plan: PersistedPlan, execution = false): Promise<void> {
    assert(
      plan.view.installationId === this.installation.installationId &&
        plan.view.executable,
      'PLAN_NOT_EXECUTABLE',
      'The update plan cannot be executed.',
    );
    assert(
      execution || Date.parse(plan.view.expiresAt) > Date.now(),
      'PLAN_EXPIRED',
      'The update plan expired. Preview the update again.',
    );
    assert(
      plan.installationFingerprint === (await this.deployment.fingerprint()),
      'INSTALLATION_DRIFT',
      'The running installation changed. Preview the update again.',
    );
    for (const component of ['backend', 'web'] as const) {
      const manifest = await this.catalog.exact(
        component,
        plan.targets[component].manifest.releaseId,
      );
      assert(
        digest(manifest) === plan.manifestDigests[component],
        'RELEASE_CHANGED',
        'An official release changed. Preview the update again.',
      );
    }
    const blockers = await this.blockers();
    assert(
      blockers.length === 0,
      blockers[0]?.code ?? 'PREFLIGHT_FAILED',
      blockers[0]?.message ?? 'The update preflight failed.',
    );
  }
}
