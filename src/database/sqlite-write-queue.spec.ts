import { AsyncResource } from 'node:async_hooks';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import {
  Column,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Repository,
} from 'typeorm';
import { installSqliteWriteQueue } from './sqlite-write-queue';

@Entity('items')
class Item {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  label: string;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('installSqliteWriteQueue', () => {
  let directory: string;
  let file: string;
  let dataSource: DataSource;
  let items: Repository<Item>;

  async function open(timeoutMs?: number): Promise<void> {
    dataSource = new DataSource({
      type: 'sqlite',
      database: file,
      entities: [Item],
      synchronize: true,
    });
    await dataSource.initialize();
    installSqliteWriteQueue(dataSource, timeoutMs);
    items = dataSource.getRepository(Item);
  }

  /** What a separate process would find in the file, i.e. what survives a restart. */
  async function labelsOnDisk(): Promise<string[]> {
    const reader = new DataSource({ type: 'sqlite', database: file });
    await reader.initialize();
    try {
      const rows: Array<{ label: string }> = await reader.query(
        'SELECT label FROM items ORDER BY id',
      );
      return rows.map((row) => row.label);
    } finally {
      await reader.destroy();
    }
  }

  function transactionDepth(): number {
    return (
      dataSource.createQueryRunner() as unknown as { transactionDepth: number }
    ).transactionDepth;
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-write-queue-'));
    file = path.join(directory, 'test.db');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (dataSource?.isInitialized) await dataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps later writes durable when a transaction starts while another commits', async () => {
    await open();

    // Start an unrelated transaction at the exact moment the first one sends
    // COMMIT. Without the queue this leaves an open SAVEPOINT behind, and
    // everything written afterwards is lost on restart.
    const runner = dataSource.createQueryRunner();
    const originalQuery = runner.query.bind(runner) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    let second: Promise<void> | undefined;
    let secondError: unknown;
    // Bound here so it runs as an independent caller, not as part of the
    // first transaction's call chain.
    const startSecond = AsyncResource.bind(() =>
      dataSource.transaction(async (manager) => {
        await manager.insert(Item, { label: 'second' });
      }),
    );
    jest.spyOn(runner, 'query').mockImplementation(((
      ...args: unknown[]
    ): Promise<unknown> => {
      const result = originalQuery(...args);
      if (args[0] === 'COMMIT' && !second) {
        second = startSecond().catch((error: unknown) => {
          secondError = error;
        });
      }
      return result;
    }) as typeof runner.query);

    await dataSource.transaction(async (manager) => {
      await manager.insert(Item, { label: 'first' });
    });
    await second;

    for (let index = 0; index < 5; index++) {
      await dataSource.transaction(async (manager) => {
        await manager.insert(Item, { label: `later-${index}` });
      });
      await items.save(items.create({ label: `saved-${index}` }));
    }

    expect(secondError).toBeUndefined();
    expect(transactionDepth()).toBe(0);
    expect(fs.existsSync(`${file}-journal`)).toBe(false);
    const onDisk = await labelsOnDisk();
    expect(onDisk).toHaveLength(12);
    expect(onDisk).toEqual(expect.arrayContaining(['first', 'second']));
  });

  it('runs overlapping transactions and saves one at a time without errors', async () => {
    await open();
    const errors: unknown[] = [];
    let expected = 0;

    for (let round = 0; round < 20; round++) {
      const jobs: Promise<void>[] = [];
      for (let job = 0; job < 4; job++) {
        expected += 2;
        jobs.push(
          (async () => {
            await sleep(Math.random() * 3);
            await dataSource.transaction(async (manager) => {
              await manager.insert(Item, { label: 'in-transaction' });
              if (Math.random() < 0.5) await sleep(Math.random() * 2);
            });
            await items.save(items.create({ label: 'saved' }));
          })().catch((error: unknown) => {
            errors.push(error);
          }),
        );
      }
      await Promise.all(jobs);
      expect(transactionDepth()).toBe(0);
    }

    expect(errors).toEqual([]);
    expect(await labelsOnDisk()).toHaveLength(expected);
    // Every write is a separate fsync; allow for a slow or busy disk.
  }, 30_000);

  it('does not queue nested transactions or repository calls made inside a transaction', async () => {
    await open(200);

    await dataSource.transaction(async (manager) => {
      await manager.insert(Item, { label: 'outer' });
      await dataSource.transaction(async (inner) => {
        await inner.insert(Item, { label: 'nested' });
      });
      await items.save(items.create({ label: 'repository' }));
      await items.update({ label: 'outer' }, { label: 'outer-updated' });
    });
    expect(await labelsOnDisk()).toEqual([
      'outer-updated',
      'nested',
      'repository',
    ]);

    // Everything done inside a failing transaction is rolled back together.
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.insert(Item, { label: 'doomed' });
        await items.save(items.create({ label: 'doomed-too' }));
        throw new Error('business rule');
      }),
    ).rejects.toThrow('business rule');
    expect(await labelsOnDisk()).toHaveLength(3);
    expect(transactionDepth()).toBe(0);
  });

  it("does not roll back another caller's write when a transaction fails", async () => {
    await open();

    const failing = dataSource.transaction(async (manager) => {
      await manager.insert(Item, { label: 'rolled-back' });
      await sleep(20);
      throw new Error('business rule');
    });
    // Issued while the failing transaction is still open.
    await sleep(5);
    const independent = items.save(items.create({ label: 'independent' }));

    await expect(failing).rejects.toThrow('business rule');
    await independent;

    expect(await labelsOnDisk()).toEqual(['independent']);
  });

  it('fails with a clear error instead of hanging when a transaction never finishes', async () => {
    await open(50);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    void dataSource.transaction(async (manager) => {
      await manager.insert(Item, { label: 'stuck' });
      await new Promise(() => undefined);
    });
    await sleep(10);

    await expect(
      items.save(items.create({ label: 'blocked' })),
    ).rejects.toThrow(/Timed out after 50 ms/);
    // Reads are not queued.
    await expect(items.count()).resolves.toBe(1);
  });

  it('leaves other database types alone', () => {
    const transaction = jest.fn();
    const mysql = {
      options: { type: 'mysql' },
      manager: { transaction },
    } as unknown as DataSource;

    expect(installSqliteWriteQueue(mysql)).toBeUndefined();
    expect(mysql.manager.transaction).toBe(transaction);
  });
});
