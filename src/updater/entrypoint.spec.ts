import { join } from 'node:path';
import * as installationModule from './installation';
import * as io from './io';
import * as backupModule from './backups';
import { ComposeDeployment } from './adapters/compose';
import { updaterMain } from './entrypoint';
import { testHarness } from './testing';

jest.mock('./adapters/compose', () => ({ ComposeDeployment: jest.fn() }));

describe('host recover command schedules the existing supervised worker', () => {
  let context: Awaited<ReturnType<typeof testHarness>>;
  const argv = process.argv;
  const releaseLock = jest.fn(() => Promise.resolve());
  beforeEach(async () => {
    context = await testHarness();
    jest
      .mocked(ComposeDeployment)
      .mockReturnValue(context.deployment as unknown as ComposeDeployment);
    jest
      .spyOn(installationModule, 'loadInstallation')
      .mockResolvedValue(context.installation);
    jest.spyOn(io, 'acquireProcessLock').mockResolvedValue(releaseLock);
    jest
      .spyOn(backupModule, 'createBackupAdapter')
      .mockReturnValue(context.backup);
    releaseLock.mockClear();
  });
  afterEach(async () => {
    process.argv = argv;
    jest.restoreAllMocks();
    await context.cleanup();
  });

  async function recoveryJob() {
    const { jobId } = await context.accept();
    const record = await context.store.job(jobId);
    record.view.status = 'recovery_required';
    record.operations.switch = 'done';
    await context.store.saveJob(record);
    context.deployment.startWorker.mockClear();
    process.argv = [...argv, `--job-id=${jobId}`];
    return record;
  }

  test('persists the same job before unlocking and scheduling the immutable supervisor', async () => {
    const record = await recoveryJob();
    context.installation.current.backend.version = '1.1.0';
    context.deployment.startWorker.mockImplementation(async (jobId) => {
      expect(releaseLock).toHaveBeenCalledTimes(1);
      expect((await context.store.job(jobId)).view.status).toBe('running');
    });
    await updaterMain('recover');
    expect(io.acquireProcessLock).toHaveBeenCalledWith(
      join(context.installation.stateDir, 'execution.lock'),
    );
    expect(jest.mocked(ComposeDeployment)).toHaveBeenLastCalledWith(
      record.originalInstallation,
    );
    expect(context.deployment.startWorker).toHaveBeenCalledWith(
      record.view.jobId,
    );
    expect(await context.store.jobs()).toHaveLength(1);
    expect(context.backup.restore).not.toHaveBeenCalled();
  });

  test('uncertain destructive restore remains blocked and releases the execution lock', async () => {
    const record = await recoveryJob();
    record.operations.restore_data = 'intent';
    await context.store.saveJob(record);
    await expect(updaterMain('recover')).rejects.toMatchObject({
      code: 'RESTORE_UNCERTAIN',
    });
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(context.deployment.startWorker).not.toHaveBeenCalled();
    expect((await context.store.job(record.view.jobId)).view.status).toBe(
      'recovery_required',
    );
  });

  test.each(['commit_decided', 'restore_decided'] as const)(
    '%s recovery preserves the decision without running a foreground restore',
    async (decision) => {
      const record = await recoveryJob();
      record.decision = decision;
      record.operations.restore_data = 'intent';
      await context.store.saveJob(record);
      await updaterMain('recover');
      expect((await context.store.job(record.view.jobId)).decision).toBe(
        decision,
      );
      expect(context.deployment.startWorker).toHaveBeenCalledWith(
        record.view.jobId,
      );
      expect(context.backup.restore).not.toHaveBeenCalled();
    },
  );

  test('failed supervised launch leaves the durably requested job for control reconciliation', async () => {
    const record = await recoveryJob();
    context.deployment.startWorker.mockRejectedValueOnce(
      new Error('service unavailable'),
    );
    await expect(updaterMain('recover')).rejects.toThrow('service unavailable');
    expect((await context.store.job(record.view.jobId)).view.status).toBe(
      'running',
    );
    expect(releaseLock).toHaveBeenCalledTimes(1);
    await context.control.reconcile();
    expect(context.deployment.startWorker).toHaveBeenLastCalledWith(
      record.view.jobId,
    );
  });
});
