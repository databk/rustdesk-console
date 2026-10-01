import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { CreateJobRequest, CreateJobResponse, JobRecord } from './contracts';
import { Planner } from './planner';
import { assert, safeError } from './errors';
import { digest, missing } from './io';
import { terminal, UUID } from './store';
import { readBuildInfo } from './build-info';
export class UpdateControl {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly planner: Planner,
    private readonly reload: () => Promise<Planner> = () =>
      Promise.resolve(planner),
  ) {}
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
  async accept(
    body: CreateJobRequest,
    actorId: string,
  ): Promise<CreateJobResponse> {
    return this.serialized(async () => {
      const planner = await this.reload();
      assert(
        body &&
          Object.keys(body).sort().join(',') ===
            'acknowledgeDowntime,idempotencyKey,planId' &&
          UUID.test(body.planId) &&
          UUID.test(body.idempotencyKey) &&
          body.acknowledgeDowntime === true &&
          typeof actorId === 'string' &&
          actorId.length > 0 &&
          actorId.length <= 100,
        'INVALID_REQUEST',
        'The update request is invalid.',
      );
      const requestDigest = digest({
        planId: body.planId,
        acknowledgeDowntime: body.acknowledgeDowntime,
      });
      const jobs = await planner.store.jobs();
      const duplicate = jobs.find(
        (job) => job.idempotencyKey === body.idempotencyKey,
      );
      if (duplicate) {
        assert(
          duplicate.requestDigest === requestDigest,
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key belongs to a different request.',
        );
        return this.response(duplicate);
      }
      assert(
        jobs.every(terminal),
        'JOB_ACTIVE',
        'Another update or recovery is already active.',
      );
      const plan = await planner.store.plan(body.planId);
      await planner.revalidate(plan);
      const createdAt = new Date().toISOString();
      const jobId = randomUUID();
      const record: JobRecord = {
        view: {
          protocolVersion: 1,
          installationId: planner.installation.installationId,
          jobId,
          planId: body.planId,
          status: 'queued',
          phase: 'preparing',
          components: plan.view.components,
          createdAt,
          updatedAt: createdAt,
          finishedAt: null,
          resultCode: null,
          safeMessage: 'The update request is durably accepted.',
          recoveryGuidance: null,
        },
        idempotencyKey: body.idempotencyKey,
        requestDigest,
        actorId,
        plan,
        originalInstallation: structuredClone(planner.installation),
        operations: {},
      };
      await planner.store.saveJob(record);
      // 已接受即保留同一身份；启动失败由 reconcile 重试，不删除作业/重建身份。
      try {
        await planner.deployment.startWorker(jobId);
      } catch {
        /* supervisor reconciliation owns retry */
      }
      return this.response(record);
    });
  }
  private response(record: JobRecord): CreateJobResponse {
    return {
      jobId: record.view.jobId,
      statusUrl: `/api/system-update/jobs/${record.view.jobId}`,
      job: record.view,
    };
  }
  async reconcile(): Promise<void> {
    await this.serialized(async () => {
      const planner = await this.reload();
      const record = await planner.store.current();
      if (
        !record ||
        terminal(record) ||
        record.view.status === 'recovery_required'
      )
        return;
      if (!(await planner.deployment.workerAlive(record.view.jobId)))
        await planner.deployment.startWorker(record.view.jobId);
    });
  }
  async dispatch(value: unknown): Promise<unknown> {
    const request = value as {
      operation: string;
      body: Record<string, unknown>;
      actorId?: string;
    };
    assert(
      request &&
        typeof request === 'object' &&
        !Array.isArray(request) &&
        Object.keys(request).every((key) =>
          ['operation', 'body', 'actorId'].includes(key),
        ) &&
        request.body &&
        typeof request.body === 'object' &&
        !Array.isArray(request.body),
      'INVALID_REQUEST',
      'The updater request is invalid.',
    );
    const planner = await this.reload();
    switch (request.operation) {
      case 'health':
        return {
          protocolVersion: 1,
          installationId: planner.installation.installationId,
          activeJobId: (await planner.store.current())?.view.jobId ?? null,
          ...readBuildInfo(),
        };
      case 'capabilities':
        return planner.capabilities();
      case 'plans':
        assert(
          Object.keys(request.body).length === 0,
          'INVALID_REQUEST',
          'Plans do not accept targets.',
        );
        return planner.create();
      case 'jobs':
        return this.accept(
          request.body as unknown as CreateJobRequest,
          request.actorId ?? '',
        );
      case 'current': {
        const job = await planner.store.current();
        return {
          installationId: planner.installation.installationId,
          job: job?.view ?? null,
        };
      }
      case 'job':
        assert(
          typeof request.body.id === 'string',
          'INVALID_REQUEST',
          'The task identifier is required.',
        );
        return (await planner.store.job(request.body.id)).view;
      default:
        assert(
          false,
          'INVALID_REQUEST',
          'The updater operation is unsupported.',
        );
    }
  }
  async listen(socketPath: string): Promise<Server> {
    const gid = Number(process.env.SYSTEM_UPDATE_SOCKET_GID);
    assert(
      Number.isSafeInteger(gid) && gid > 0,
      'IPC_GROUP_MISSING',
      'The managed application group must be configured for the private updater socket.',
    );
    await fs.mkdir(dirname(socketPath), { recursive: true, mode: 0o750 });
    await fs.chown(dirname(socketPath), 0, gid);
    await fs.chmod(dirname(socketPath), 0o750);
    try {
      await fs.unlink(socketPath);
    } catch (error: unknown) {
      if (!missing(error)) throw error;
    }
    const server = createServer((request, response) => {
      void (async () => {
        try {
          assert(
            request.method === 'POST' && request.url === '/',
            'INVALID_REQUEST',
            'The updater transport request is invalid.',
          );
          let raw = '';
          for await (const chunk of request) {
            raw += (chunk as Buffer).toString('utf8');
            assert(
              raw.length <= 4096,
              'INVALID_REQUEST',
              'The updater request is too large.',
            );
          }
          const result = await this.dispatch(JSON.parse(raw));
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(result));
        } catch (error: unknown) {
          const safe = safeError(error);
          response.writeHead(
            safe.code === 'INVALID_REQUEST' ? 400 : safe.status,
            { 'Content-Type': 'application/json' },
          );
          response.end(
            JSON.stringify({ code: safe.code, message: safe.message }),
          );
        }
      })();
    });
    server.requestTimeout = 180_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    await fs.chown(socketPath, 0, gid);
    await fs.chmod(socketPath, 0o660);
    return server;
  }
}
