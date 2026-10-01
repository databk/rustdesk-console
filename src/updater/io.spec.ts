import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UpdateStore } from './store';
import { JournalError } from './errors';
import { atomicWrite, missing } from './io';
import { readMaintenance, businessWritesAllowed } from './maintenance';
import { testHarness } from './testing';
describe('durable journal and maintenance failures', () => {
  test('recognizes native filesystem errors across VM realms', async () => {
    try {
      await fs.readFile(join(tmpdir(), randomUUID(), 'absent'));
      throw new Error('unexpected file');
    } catch (error: unknown) {
      expect(missing(error)).toBe(true);
    }
    expect(missing(new Error('not missing'))).toBe(false);
    expect(missing(null)).toBe(false);
  });
  test('an atomic rename failure preserves the prior task and becomes a journal failure', async () => {
    const context = await testHarness();
    try {
      const { jobId } = await context.accept();
      const record = await context.store.job(jobId);
      record.decision = 'commit_decided';
      const rename = jest
        .spyOn(fs, 'rename')
        .mockRejectedValueOnce(
          Object.assign(new Error('disk unavailable'), { code: 'EIO' }),
        );
      await expect(context.store.saveJob(record)).rejects.toBeInstanceOf(
        JournalError,
      );
      rename.mockRestore();
      expect(
        (await new UpdateStore(context.installation.stateDir).job(jobId))
          .decision,
      ).toBeUndefined();
    } finally {
      jest.restoreAllMocks();
      await context.cleanup();
    }
  });
  test('missing optional fence permits legacy startup but malformed fence denies business writes', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'console-fence-test-'));
    const path = join(root, 'maintenance.json');
    const previous = process.env.SYSTEM_UPDATE_MAINTENANCE_FILE;
    try {
      process.env.SYSTEM_UPDATE_MAINTENANCE_FILE = path;
      expect(readMaintenance()).toBeNull();
      expect(businessWritesAllowed()).toBe(true);
      await fs.writeFile(path, '{broken');
      expect(businessWritesAllowed()).toBe(false);
      expect(() => readMaintenance()).toThrow('unreadable');
      await atomicWrite(
        path,
        {
          schemaVersion: 1,
          jobId: randomUUID(),
          active: true,
          allowStart: true,
        },
        0o644,
      );
      expect(businessWritesAllowed()).toBe(false);
    } finally {
      if (previous === undefined)
        delete process.env.SYSTEM_UPDATE_MAINTENANCE_FILE;
      else process.env.SYSTEM_UPDATE_MAINTENANCE_FILE = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
