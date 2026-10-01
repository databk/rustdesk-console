import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { testHarness } from './testing';
import { UpdateWorker } from './worker';
import { JournalError, UpdateError } from './errors';
import { readMaintenance } from './maintenance';
import { JobRecord } from './contracts';
describe('durable worker failure and decision boundaries', () => {
  let context: Awaited<ReturnType<typeof testHarness>>;
  beforeEach(async () => {
    context = await testHarness();
  });
  afterEach(async () => {
    await context.cleanup();
  });
  test('backs up only after stop and persists commit before reopening', async () => {
    const { jobId } = await context.accept();
    const observed: string[] = [];
    await new UpdateWorker(context.planner, async (event, record) => {
      observed.push(event);
      if (event === 'after:commit_decided') {
        expect((await context.store.job(jobId)).decision).toBe(
          'commit_decided',
        );
        expect(
          readMaintenance(context.installation.maintenanceFile)?.active,
        ).toBe(true);
      }
      if (event === 'switch:intent') expect(record.snapshot).toBeDefined();
    }).run(jobId);
    expect(context.events.indexOf('stop')).toBeLessThan(
      context.events.indexOf('backup'),
    );
    expect(context.events.indexOf('backup')).toBeLessThan(
      context.events.indexOf('switch'),
    );
    expect((await context.store.job(jobId)).view.status).toBe('succeeded');
    expect(observed).toContain('after:commit_decided');
    expect(readMaintenance(context.installation.maintenanceFile)?.active).toBe(
      false,
    );
    expect(context.backup.restore).not.toHaveBeenCalled();
  });
  test('backup failure never switches programs and restores original service availability', async () => {
    const { jobId } = await context.accept();
    context.backup.backup.mockRejectedValue(
      new Error('password=do-not-expose'),
    );
    await new UpdateWorker(context.planner).run(jobId);
    const record = await context.store.job(jobId);
    expect(record.view.status).toBe('failed');
    expect(record.view.safeMessage).not.toContain('password');
    expect(context.deployment.switchApplications).not.toHaveBeenCalled();
    expect(context.backup.restore).not.toHaveBeenCalled();
  });
  test('target verification failure restores program AND snapshot before rolled_back', async () => {
    const { jobId } = await context.accept();
    context.deployment.verify.mockRejectedValueOnce(
      new UpdateError('HEALTH_FAILED', 'Target startup failed'),
    );
    await new UpdateWorker(context.planner).run(jobId);
    const record = await context.store.job(jobId);
    expect(record.view.status).toBe('rolled_back');
    expect(record.decision).toBe('restore_decided');
    expect(context.backup.restore).toHaveBeenCalledTimes(1);
    expect(context.events.indexOf('restore-deployment')).toBeLessThan(
      context.events.indexOf('restore-data'),
    );
    expect(context.events.indexOf('restore-data')).toBeLessThan(
      context.events.indexOf('verify-old'),
    );
  });
  test('restore failure remains fenced and never reports rolled_back', async () => {
    const { jobId } = await context.accept();
    context.deployment.verify.mockRejectedValueOnce(new Error('target failed'));
    context.backup.restore.mockRejectedValue(new Error('restore failed'));
    await new UpdateWorker(context.planner).run(jobId);
    expect((await context.store.job(jobId)).view.status).toBe(
      'recovery_required',
    );
    expect(readMaintenance(context.installation.maintenanceFile)?.active).toBe(
      true,
    );
  });
  test.each(['commit_decided', 'restore_decided'] as const)(
    '%s journal failure never releases the fence',
    async (decision) => {
      const { jobId } = await context.accept();
      if (decision === 'restore_decided')
        context.deployment.verify.mockRejectedValueOnce(
          new Error('target failed'),
        );
      const save = context.store.saveJob.bind(context.store);
      jest
        .spyOn(context.store, 'saveJob')
        .mockImplementation(async (record) => {
          if (record.decision === decision) throw new JournalError();
          await save(record);
        });
      await expect(
        new UpdateWorker(context.planner).run(jobId),
      ).rejects.toBeInstanceOf(JournalError);
      expect((await context.store.job(jobId)).decision).toBeUndefined();
      expect(
        readMaintenance(context.installation.maintenanceFile)?.active,
      ).toBe(true);
    },
  );
  test.each(['commit_decided', 'restore_decided'] as const)(
    're-establishes durability of visible %s before reopening on restart',
    async (decision) => {
      const { jobId } = await context.accept();
      if (decision === 'restore_decided')
        context.deployment.verify.mockRejectedValueOnce(
          new Error('target failed'),
        );
      const jobFile = join(context.store.root, 'jobs', `${jobId}.json`);
      const rename = fs.rename.bind(fs);
      let rejectDirectorySync = true;
      const renameSpy = jest
        .spyOn(fs, 'rename')
        .mockImplementation(async (source, destination) => {
          await rename(source, destination);
          if (
            rejectDirectorySync &&
            destination === jobFile &&
            (await context.store.job(jobId)).decision === decision
          ) {
            // 在真实 rename 后注入下一步目录同步失败，Windows 同样覆盖可见窗口。
            throw Object.assign(new Error('Job directory sync failed'), {
              code: 'EIO',
            });
          }
        });
      try {
        await expect(
          new UpdateWorker(context.planner).run(jobId),
        ).rejects.toBeInstanceOf(JournalError);
        expect((await context.store.job(jobId)).decision).toBe(decision);
        expect(
          readMaintenance(context.installation.maintenanceFile)?.active,
        ).toBe(true);

        context.deployment.verify.mockClear();
        context.deployment.restoreDeployment.mockClear();
        context.backup.restore.mockClear();
        await expect(
          new UpdateWorker(context.planner).run(jobId),
        ).rejects.toBeInstanceOf(JournalError);
        expect(context.deployment.verify).not.toHaveBeenCalled();
        expect(context.deployment.restoreDeployment).not.toHaveBeenCalled();
        expect(context.backup.restore).not.toHaveBeenCalled();
        expect(
          readMaintenance(context.installation.maintenanceFile)?.active,
        ).toBe(true);

        rejectDirectorySync = false;
        await new UpdateWorker(context.planner).run(jobId);
        const completed = await context.store.job(jobId);
        expect(completed.view.jobId).toBe(jobId);
        expect(completed.decision).toBe(decision);
        expect(completed.view.status).toBe(
          decision === 'commit_decided' ? 'succeeded' : 'rolled_back',
        );
        expect(context.deployment.verify).toHaveBeenCalledTimes(1);
        expect(context.deployment.restoreDeployment).not.toHaveBeenCalled();
        expect(context.backup.restore).not.toHaveBeenCalled();
        expect(
          readMaintenance(context.installation.maintenanceFile)?.active,
        ).toBe(false);
      } finally {
        renameSpy.mockRestore();
      }
    },
  );
  test.each(['commit_decided', 'restore_decided'] as const)(
    'restarting after %s preserves reopened business writes',
    async (decision) => {
      const { jobId } = await context.accept();
      if (decision === 'restore_decided')
        context.deployment.verify.mockRejectedValueOnce(
          new Error('target failed'),
        );
      const sentinel = context.installation.dataDir + '-after-open';
      let reopened = false;
      await expect(
        new UpdateWorker(context.planner, async (event, record) => {
          if (event !== 'business_reopened') return;
          reopened = true;
          expect(record.decision).toBe(decision);
          expect(
            readMaintenance(context.installation.maintenanceFile)?.active,
          ).toBe(false);
          const durable = await context.store.job(jobId);
          expect(durable.decision).toBe(decision);
          expect(durable.view.status).toBe('running');
          expect(durable.view.finishedAt).toBeNull();
          await fs.writeFile(sentinel, 'new business write');
          throw new JournalError();
        }).run(jobId),
      ).rejects.toBeInstanceOf(JournalError);
      expect(reopened).toBe(true);
      context.backup.restore.mockClear();
      context.deployment.restoreDeployment.mockClear();
      await new UpdateWorker(context.planner).run(jobId);
      expect(context.backup.restore).not.toHaveBeenCalled();
      expect(context.deployment.restoreDeployment).not.toHaveBeenCalled();
      expect(await fs.readFile(sentinel, 'utf8')).toBe('new business write');
      expect((await context.store.job(jobId)).decision).toBe(decision);
      expect((await context.store.job(jobId)).view.status).toBe(
        decision === 'commit_decided' ? 'succeeded' : 'rolled_back',
      );
    },
  );
  test('crash after installation commit but before decision restores original installation facts', async () => {
    const { jobId } = await context.accept();
    let atCommit: JobRecord | undefined;
    await new UpdateWorker(context.planner, (event, record) => {
      return Promise.resolve().then(() => {
        if (event === 'persist_installation:done') {
          atCommit = structuredClone(record);
          throw new JournalError();
        }
      });
    })
      .run(jobId)
      .catch((error) => {
        expect(error).toBeInstanceOf(JournalError);
      });
    expect(atCommit).toBeDefined();
    expect((await context.store.job(jobId)).decision).toBeUndefined();
    await new UpdateWorker(context.planner).run(jobId);
    expect(context.deployment.restoreDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        originalInstallation: expect.objectContaining({
          current: expect.objectContaining({
            backend: expect.objectContaining({ version: '1.0.0' }),
          }),
        }),
      }),
    );
    expect((await context.store.job(jobId)).view.status).toBe('rolled_back');
  });
  test('interrupted restore SQL is never blindly re-executed', async () => {
    const { jobId } = await context.accept();
    const record = await context.store.job(jobId);
    record.view.status = 'running';
    record.operations = {
      fence: 'done',
      switch: 'done',
      restore_data: 'intent',
    };
    await context.store.saveJob(record);
    await new UpdateWorker(context.planner).run(jobId);
    expect(context.backup.restore).not.toHaveBeenCalled();
    expect((await context.store.job(jobId)).view.status).toBe(
      'recovery_required',
    );
  });
});
