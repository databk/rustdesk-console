import { randomUUID } from 'node:crypto';
import { UpdateError } from './errors';
import { testHarness, testRelease } from './testing';
import { UpdateControl } from './control';
import { Planner } from './planner';
describe('official update planning and durable acceptance', () => {
  let context: Awaited<ReturnType<typeof testHarness>>;
  beforeEach(async () => {
    context = await testHarness();
  });
  afterEach(async () => {
    await context.cleanup();
  });
  test.each([
    ['1.1.0', '1.1.0', ['update', 'update']],
    ['1.1.0', '1.0.0', ['update', 'unchanged']],
    ['1.0.0', '1.1.0', ['unchanged', 'update']],
    ['1.0.0', '1.0.0', ['unchanged', 'unchanged']],
  ])(
    'plans backend %s and web %s without arbitrary component choice',
    async (backend, web, actions) => {
      context.catalog.latest.mockImplementation((component) =>
        Promise.resolve(
          testRelease(component, component === 'backend' ? backend : web)
            .manifest,
        ),
      );
      const plan = await context.planner.create();
      expect(plan.components.map((component) => component.action)).toEqual(
        actions,
      );
      expect(plan.executable).toBe(actions.includes('update'));
    },
  );
  test('does not silently choose an older version when latest artifacts are pending', async () => {
    context.catalog.latest.mockRejectedValueOnce(
      new UpdateError('MANIFEST_PENDING', 'Latest release not ready'),
    );
    const plan = await context.planner.create();
    expect(plan.executable).toBe(false);
    expect(plan.blockers[0].code).toBe('MANIFEST_PENDING');
  });
  test('requires bidirectional declared compatibility', async () => {
    context.catalog.latest.mockImplementation((component) => {
      return Promise.resolve().then(() => {
        const manifest = testRelease(component, '1.1.0').manifest;
        if (component === 'web') manifest.peerVersionRange = '>=2.0.0 <3.0.0';
        return manifest;
      });
    });
    expect((await context.planner.create()).blockers).toContainEqual(
      expect.objectContaining({ code: 'INCOMPATIBLE_RELEASES' }),
    );
  });
  test('backup preflight blocks a connected database with insufficient recovery rights', async () => {
    context.backup.preflight.mockResolvedValue([
      {
        code: 'RESTORE_PRIVILEGES_MISSING',
        message: 'Dedicated schema restore permission is missing.',
      },
    ]);
    expect((await context.planner.capabilities()).ready).toBe(false);
    expect((await context.planner.create()).executable).toBe(false);
  });
  test('revalidates official release identity and installation before accepting', async () => {
    const plan = await context.planner.create();
    context.catalog.exact.mockRejectedValue(
      new UpdateError('NON_STABLE_RELEASE', 'Release became a prerelease'),
    );
    await expect(
      context.control.accept(
        {
          planId: plan.planId,
          idempotencyKey: randomUUID(),
          acknowledgeDowntime: true,
        },
        'admin',
      ),
    ).rejects.toMatchObject({ code: 'NON_STABLE_RELEASE' });
    expect(await context.store.jobs()).toHaveLength(0);
  });
  test('rejects expired plans and changed configuration', async () => {
    const plan = await context.planner.create();
    const saved = await context.store.plan(plan.planId);
    saved.view.expiresAt = new Date(0).toISOString();
    await context.store.savePlan(saved);
    await expect(context.planner.revalidate(saved)).rejects.toMatchObject({
      code: 'PLAN_EXPIRED',
    });
    saved.view.expiresAt = new Date(Date.now() + 10_000).toISOString();
    context.deployment.fingerprint.mockResolvedValue('changed');
    await expect(context.planner.revalidate(saved)).rejects.toMatchObject({
      code: 'INSTALLATION_DRIFT',
    });
  });
  test('concurrent same-key requests and a restarted controller recover one persisted job', async () => {
    const plan = await context.planner.create();
    const body = {
      planId: plan.planId,
      idempotencyKey: randomUUID(),
      acknowledgeDowntime: true as const,
    };
    const [first, second] = await Promise.all([
      context.control.accept(body, 'admin'),
      context.control.accept(body, 'admin'),
    ]);
    expect(first.jobId).toBe(second.jobId);
    expect(await context.store.jobs()).toHaveLength(1);
    expect(
      (await new UpdateControl(context.planner).accept(body, 'admin')).jobId,
    ).toBe(first.jobId);
    expect(context.deployment.startWorker).toHaveBeenCalledTimes(1);
    await expect(
      context.control.accept({ ...body, planId: randomUUID() }, 'admin'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      context.control.accept(
        { ...body, idempotencyKey: randomUUID() },
        'admin',
      ),
    ).rejects.toMatchObject({ code: 'JOB_ACTIVE' });
  });
  test('supervisor never creates a new job on startup and retries accepted launch failure', async () => {
    await context.control.reconcile();
    expect(context.deployment.startWorker).not.toHaveBeenCalled();
    context.deployment.startWorker.mockRejectedValueOnce(
      new Error('launch failure'),
    );
    const response = await context.accept();
    await context.control.reconcile();
    expect(context.deployment.startWorker).toHaveBeenLastCalledWith(
      response.jobId,
    );
    expect(await context.store.jobs()).toHaveLength(1);
  });
  test('control refreshes committed installation facts without requiring another helper restart', async () => {
    const next = structuredClone(context.installation);
    next.current.web = testRelease('web', '1.1.0');
    const refreshed = new Planner(
      next,
      context.deployment,
      context.backup,
      context.catalog,
      context.store,
    );
    const control = new UpdateControl(context.planner, () =>
      Promise.resolve(refreshed),
    );
    expect(
      await control.dispatch({ operation: 'capabilities', body: {} }),
    ).toMatchObject({ current: { backend: '1.0.0', web: '1.1.0' } });
  });
  test('rejects IPC arbitrary source fields and safe projections omit private records', async () => {
    await expect(
      context.control.dispatch({
        operation: 'plans',
        body: { url: 'https://evil.test/archive' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const { jobId } = await context.accept();
    const projection = await context.control.dispatch({
      operation: 'job',
      body: { id: jobId },
    });
    expect(projection).not.toHaveProperty('originalInstallation');
    expect(projection).not.toHaveProperty('snapshot');
    expect(JSON.stringify(projection)).not.toContain(context.root);
  });
});
