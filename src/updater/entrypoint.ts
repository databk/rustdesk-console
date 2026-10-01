import { join } from 'node:path';
import { loadInstallation } from './installation';
import { acquireProcessLock } from './io';
import { UpdateStore, UUID } from './store';
import { Planner } from './planner';
import { OfficialCatalog } from './catalog';
import { ComposeDeployment } from './adapters/compose';
import { LinuxDeployment } from './adapters/linux';
import { createBackupAdapter } from './backups';
import { UpdateControl } from './control';
import { UpdateWorker } from './worker';
import { assert, safeError } from './errors';
import { Installation } from './contracts';
function createPlanner(
  installation: Installation,
  store: UpdateStore,
): Planner {
  return new Planner(
    installation,
    installation.deployment === 'managed-compose'
      ? new ComposeDeployment(installation)
      : new LinuxDeployment(installation),
    createBackupAdapter(installation.database),
    new OfficialCatalog(),
    store,
  );
}
export class UpdaterRuntime {
  // 集成测试只能通过构造器替换依赖；生产 CLI 始终使用严格的默认来源与安装校验。
  constructor(
    private readonly dependencies: {
      loadInstallation?: typeof loadInstallation;
      createPlanner?: typeof createPlanner;
      observe?: ConstructorParameters<typeof UpdateWorker>[1];
    } = {},
  ) {}
  async run(mode: string): Promise<void> {
    assert(
      ['updater', 'worker', 'recover'].includes(mode),
      'INVALID_MODE',
      'The updater mode is unsupported.',
    );
    const readInstallation =
      this.dependencies.loadInstallation ?? loadInstallation;
    const makePlanner = this.dependencies.createPlanner ?? createPlanner;
    let installation = await readInstallation();
    const store = new UpdateStore(installation.stateDir);
    await store.initialize();
    const jobId = process.argv
      .find((value) => value.startsWith('--job-id='))
      ?.slice('--job-id='.length);
    if (mode !== 'updater') {
      assert(
        jobId && UUID.test(jobId),
        'INVALID_ID',
        'A valid update task identifier is required.',
      );
      const record = await store.job(jobId);
      installation = record.originalInstallation;
    }
    const releaseLock = await acquireProcessLock(
      join(
        installation.stateDir,
        mode === 'updater' ? 'control.lock' : 'execution.lock',
      ),
    );
    const planner = makePlanner(installation, store);
    const { deployment } = planner;
    if (mode === 'recover') {
      try {
        const record = await store.job(jobId!);
        assert(
          record.decision || record.operations.restore_data !== 'intent',
          'RESTORE_UNCERTAIN',
          'An interrupted database restoration needs manual verification. Preserve the recovery set and consult the host recovery guide.',
        );
        if (record.view.status === 'recovery_required') {
          record.view.status = 'running';
          await store.saveJob(record);
        }
      } finally {
        await releaseLock();
      }
      // 只持久化同一任务的恢复请求，再交给独立 supervisor；CLI 退出不终止恢复。
      await deployment.startWorker(jobId!);
      return;
    }
    if (mode !== 'updater') {
      try {
        await new UpdateWorker(planner, this.dependencies.observe).run(jobId!);
      } finally {
        await releaseLock();
      }
      return;
    }
    const control = new UpdateControl(planner, async () => {
      const current = await readInstallation();
      assert(
        current.installationId === installation.installationId &&
          current.stateDir === installation.stateDir,
        'INSTALLATION_DRIFT',
        'The managed installation identity changed.',
      );
      return makePlanner(current, store);
    });
    const server = await control.listen(
      process.env.SYSTEM_UPDATE_SOCKET ??
        join(installation.ipcDir, 'control.sock'),
    );
    const reconcile = () =>
      control.reconcile().catch((error) => {
        process.stderr.write(`${safeError(error).code}\n`);
      });
    await reconcile();
    const timer = setInterval(() => void reconcile(), 10_000);
    const shutdown = () => {
      clearInterval(timer);
      server.close(() => {
        void releaseLock().finally(() => process.exit(0));
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
}
export async function updaterMain(mode: string): Promise<void> {
  await new UpdaterRuntime().run(mode);
}
