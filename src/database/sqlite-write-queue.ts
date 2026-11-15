import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

export const DEFAULT_WRITE_QUEUE_TIMEOUT_MS = 30_000;

/**
 * EntityManager methods that either open a transaction (`transaction`,
 * `save`, `remove`, `softRemove`, `recover`) or write a single statement.
 * Reads are left alone.
 */
const QUEUED_MANAGER_METHODS = [
  'transaction',
  'save',
  'remove',
  'softRemove',
  'recover',
  'insert',
  'upsert',
  'update',
  'updateAll',
  'delete',
  'deleteAll',
  'softDelete',
  'restore',
  'increment',
  'decrement',
] as const;

interface Section {
  active: boolean;
}

/**
 * Runs pieces of work strictly one after another.
 *
 * Work started from inside a running piece of work (same async call chain)
 * is not queued again: it is part of that piece of work, for example a
 * nested transaction or a repository call inside a transaction callback.
 */
export class SqliteWriteQueue {
  private readonly logger = new Logger('Database');
  private readonly context = new AsyncLocalStorage<Section>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly timeoutMs: number = DEFAULT_WRITE_QUEUE_TIMEOUT_MS,
  ) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()?.active) {
      return work();
    }
    return this.enqueue(work);
  }

  private async enqueue<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => finished);

    try {
      await this.waitFor(previous);
    } catch (error) {
      // Give up our turn, but keep the order for whoever queued behind us.
      release();
      throw error;
    }

    const section: Section = { active: true };
    try {
      return await this.context.run(section, work);
    } finally {
      // Work that outlives its section (fire-and-forget promises) must queue
      // again instead of being mistaken for part of it.
      section.active = false;
      release();
    }
  }

  /**
   * A transaction callback that never finishes would otherwise block every
   * later write for good. Failing loudly after a timeout keeps the problem
   * visible and lets requests return an error instead of hanging.
   */
  private waitFor(previous: Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const message = `Timed out after ${this.timeoutMs} ms waiting for another database write or transaction to finish`;
        this.logger.error(message);
        reject(new Error(message));
      }, this.timeoutMs);
      void previous.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * TypeORM's SQLite driver uses one connection and one shared query runner
 * for the whole data source. The runner counts transaction depth, so when
 * two `dataSource.transaction()` calls (or implicit `save()` transactions)
 * overlap, the second one becomes a SAVEPOINT of the first. If the first
 * commits while the second is starting, the runner is left with an open
 * SAVEPOINT and a depth that never returns to zero. From then on every write
 * is nested inside a transaction that never commits: callers see no error,
 * the process reads its own writes, nothing reaches the database file, and a
 * restart rolls everything back.
 *
 * Even without that leak, an overlapping write joins whichever transaction
 * is open and is rolled back with it if that transaction fails.
 *
 * This queues transactions and writes made through the data source's default
 * EntityManager (which backs `dataSource.transaction()` and every injected
 * repository) so they run one at a time. Managers handed to transaction
 * callbacks are untouched, so nesting still works. Other database types use
 * a connection per transaction and are left alone.
 *
 * Not covered: writes issued through `createQueryBuilder()` or raw
 * `query()` outside a transaction. They do not open transactions, so they
 * cannot cause the leak.
 */
export function installSqliteWriteQueue(
  dataSource: DataSource,
  timeoutMs?: number,
): SqliteWriteQueue | undefined {
  if (dataSource.options.type !== 'sqlite') {
    return undefined;
  }

  const queue = new SqliteWriteQueue(timeoutMs);
  type ManagerMethod = (...args: unknown[]) => Promise<unknown>;
  const manager = dataSource.manager as unknown as Record<
    string,
    ManagerMethod
  >;
  for (const name of QUEUED_MANAGER_METHODS) {
    const original = manager[name];
    manager[name] = (...args: unknown[]) =>
      queue.run(() => original.apply(manager, args) as Promise<unknown>);
  }
  return queue;
}
