import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { JobRecord, PersistedPlan } from './contracts';
import { atomicWrite, missing, readJson } from './io';
import { assert, JournalError, UpdateError } from './errors';
export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const terminal = (record: JobRecord): boolean =>
  ['succeeded', 'failed', 'rolled_back'].includes(record.view.status);
export class UpdateStore {
  constructor(readonly root: string) {}
  async initialize(): Promise<void> {
    for (const directory of [
      this.root,
      join(this.root, 'plans'),
      join(this.root, 'jobs'),
    ])
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  }
  private path(kind: 'jobs' | 'plans', id: string): string {
    assert(
      UUID.test(id),
      'INVALID_ID',
      'The update resource identifier is invalid.',
    );
    return join(this.root, kind, `${id}.json`);
  }
  async savePlan(plan: PersistedPlan): Promise<void> {
    await atomicWrite(this.path('plans', plan.view.planId), plan);
  }
  async plan(id: string): Promise<PersistedPlan> {
    return this.read<PersistedPlan>('plans', id);
  }
  async job(id: string): Promise<JobRecord> {
    return this.read<JobRecord>('jobs', id);
  }
  private async read<T>(kind: 'jobs' | 'plans', id: string): Promise<T> {
    try {
      return await readJson<T>(this.path(kind, id));
    } catch (error: unknown) {
      if (missing(error))
        throw new UpdateError(
          'RESOURCE_NOT_FOUND',
          'The update resource was not found.',
          404,
        );
      throw error;
    }
  }
  async saveJob(record: JobRecord): Promise<void> {
    record.view.updatedAt = new Date().toISOString();
    try {
      await atomicWrite(this.path('jobs', record.view.jobId), record);
    } catch {
      throw new JournalError();
    }
  }
  async jobs(): Promise<JobRecord[]> {
    const entries = await fs.readdir(join(this.root, 'jobs'));
    const records = await Promise.all(
      entries
        .filter(
          (name) =>
            UUID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'),
        )
        .map((name) => readJson<JobRecord>(join(this.root, 'jobs', name))),
    );
    return records.sort((a, b) =>
      b.view.createdAt.localeCompare(a.view.createdAt),
    );
  }
  async current(): Promise<JobRecord | null> {
    const jobs = await this.jobs();
    const active = jobs.filter((job) => !terminal(job));
    assert(
      active.length <= 1,
      'OWNERSHIP_UNCERTAIN',
      'Multiple unfinished jobs require host recovery.',
    );
    return active[0] ?? jobs[0] ?? null;
  }
}
