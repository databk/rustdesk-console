import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { SystemUpdateService } from '../modules/system-update/system-update.service';
import {
  Capabilities,
  CreateJobResponse,
  CurrentJobResponse,
  JobStatus,
  JobView,
  UpdatePlan,
} from './contracts';
import { UpdateError } from './errors';
import { testHarness, testRelease } from './testing';
import { UpdateWorker } from './worker';

const { examples } = JSON.parse(
  readFileSync(join(__dirname, 'protocol.fixture.json'), 'utf8'),
) as {
  examples: {
    capabilities: Record<'ready' | 'helperMissing' | 'activeJob', Capabilities>;
    plans: Record<
      'both' | 'backendOnly' | 'webOnly' | 'noUpdates' | 'blocked',
      UpdatePlan
    >;
    createJob: CreateJobResponse;
    currentJob: Record<'active' | 'none', CurrentJobResponse>;
    jobs: Record<JobStatus, JobView>;
  };
};

// 只归一化时钟和生成的身份；字段、枚举、提示和嵌套投影必须由真实生产者匹配。
function normalize(value: unknown, key = ''): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => normalize(entry));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        normalize(entry, name),
      ]),
    );
  if (['installationId', 'planId', 'jobId'].includes(key))
    return examples.jobs.queued[key];
  if (key === 'activeJobId') return examples.jobs.queued.jobId;
  if (key === 'statusUrl') return examples.createJob.statusUrl;
  if (key === 'expiresAt') return examples.plans.both.expiresAt;
  if (['createdAt', 'updatedAt', 'finishedAt'].includes(key))
    return examples.jobs.queued.createdAt;
  if (key === 'recoveryGuidance' && typeof value === 'string')
    return value.replace(/[a-f0-9-]{36}/g, examples.jobs.queued.jobId);
  return value;
}

describe('canonical API response examples match their runtime producers', () => {
  let context: Awaited<ReturnType<typeof testHarness>>;
  beforeEach(async () => {
    context = await testHarness();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await context.cleanup();
  });

  test('ready and active-job capability responses and current job projections', async () => {
    expect(normalize(await context.planner.capabilities())).toEqual(
      examples.capabilities.ready,
    );
    expect(
      normalize(
        await context.control.dispatch({ operation: 'current', body: {} }),
      ),
    ).toEqual(examples.currentJob.none);
    const accepted = await context.accept();
    expect(normalize(accepted)).toEqual(examples.createJob);
    expect(normalize(await context.planner.capabilities())).toEqual(
      examples.capabilities.activeJob,
    );
    expect(
      normalize(
        await context.control.dispatch({ operation: 'current', body: {} }),
      ),
    ).toEqual(examples.currentJob.active);
    expect(
      normalize(
        await context.control.dispatch({
          operation: 'job',
          body: { id: accepted.jobId },
        }),
      ),
    ).toEqual(examples.jobs.queued);
  });

  test('missing helper response comes from the actual API fallback', async () => {
    const request = new EventEmitter() as http.ClientRequest;
    request.end = jest.fn(() => {
      queueMicrotask(() =>
        request.emit(
          'error',
          Object.assign(new Error('missing'), { code: 'ENOENT' }),
        ),
      );
      return request;
    });
    jest.spyOn(http, 'request').mockReturnValue(request);
    expect(await new SystemUpdateService().capabilities()).toEqual(
      examples.capabilities.helperMissing,
    );
  });

  test.each([
    ['both', '1.1.0', '1.1.0'],
    ['backendOnly', '1.1.0', '1.0.0'],
    ['webOnly', '1.0.0', '1.1.0'],
    ['noUpdates', '1.0.0', '1.0.0'],
    ['blocked', '1.1.0', '1.1.0'],
  ] as const)('%s plan', async (name, backend, web) => {
    context.catalog.latest.mockImplementation((component) => {
      const manifest = testRelease(
        component,
        component === 'backend' ? backend : web,
      ).manifest;
      if (name === 'blocked' && component === 'web')
        manifest.peerVersionRange = '>=2.0.0 <3.0.0';
      return Promise.resolve(manifest);
    });
    expect(normalize(await context.planner.create())).toEqual(
      examples.plans[name],
    );
  });

  test.each([
    'running',
    'succeeded',
    'failed',
    'rolled_back',
    'recovery_required',
  ] as const)('%s job response', async (status) => {
    const accepted = await context.accept();
    if (status === 'failed')
      context.deployment.prepare.mockRejectedValueOnce(
        new UpdateError(
          'ARTIFACT_DIGEST_MISMATCH',
          'The release archive did not match its official integrity metadata.',
        ),
      );
    if (status === 'rolled_back' || status === 'recovery_required')
      context.deployment.verify.mockRejectedValueOnce(
        new Error('test startup failed'),
      );
    if (status === 'recovery_required')
      context.backup.restore.mockRejectedValueOnce(
        new Error('test restore failed'),
      );
    let running: JobView | undefined;
    await new UpdateWorker(context.planner, (event, record) => {
      if (event === 'switch:intent') running = structuredClone(record.view);
      return Promise.resolve();
    }).run(accepted.jobId);
    const result =
      status === 'running'
        ? running
        : (await context.store.job(accepted.jobId)).view;
    expect(normalize(result)).toEqual(examples.jobs[status]);
    expect(result).not.toHaveProperty('originalInstallation');
    expect(result).not.toHaveProperty('snapshot');
    expect(JSON.stringify(result)).not.toContain(context.root);
  });
});
