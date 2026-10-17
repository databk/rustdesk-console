import { DataSource, MigrationExecutor, QueryRunner } from 'typeorm';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';

const INITIAL_MIGRATION = new InitialSchema1790985600000().name;
const MYSQL_MIGRATION_LOCK = 'rustdesk_migrations';

interface SchemaDiffQuery {
  query: string;
  parameters?: unknown[];
}

interface SchemaDiff {
  upQueries: SchemaDiffQuery[];
}

/** Hold one MySQL connection's advisory lock for the entire migration flow. */
export async function withMigrationLock<T>(
  dataSource: DataSource,
  action: () => Promise<T>,
): Promise<T> {
  if (dataSource.options.type !== 'mysql') return action();

  const runner = dataSource.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    const rows = (await runner.query('SELECT GET_LOCK(?, 120) AS acquired', [
      MYSQL_MIGRATION_LOCK,
    ])) as Array<{ acquired: number | null }>;
    if (Number(rows[0]?.acquired) !== 1) {
      throw new Error('Timed out waiting for the MySQL migration lock');
    }
    locked = true;
    return await action();
  } finally {
    try {
      if (locked) {
        await runner.query('SELECT RELEASE_LOCK(?)', [MYSQL_MIGRATION_LOCK]);
      }
    } finally {
      await runner.release();
    }
  }
}

/**
 * Adopt a database created by the old synchronize configuration. When the
 * schema already matches the current entities, record the initial migration as
 * completed. When schema drift is detected and no migration history table
 * exists, repair the drift once before baselining. This runs before any later
 * migrations.
 */
export async function baselineExistingDatabase(
  dataSource: DataSource,
): Promise<boolean> {
  const executor = new MigrationExecutor(dataSource);
  if (
    !dataSource.migrations.some(
      (migration) => migration.name === INITIAL_MIGRATION,
    )
  ) {
    throw new Error('Initial schema migration is not registered');
  }
  const initial = (await executor.getPendingMigrations()).find(
    (migration) => migration.name === INITIAL_MIGRATION,
  );
  if (!initial) return false;

  const runner = dataSource.createQueryRunner();
  try {
    const tablePaths = dataSource.entityMetadatas
      .filter(
        (metadata) => metadata.synchronize && metadata.tableType === 'regular',
      )
      .map((metadata) => metadata.tablePath);
    const existingTables = await runner.getTables(tablePaths);
    if (existingTables.length === 0) return false;

    const schemaDiff = await dataSource.driver.createSchemaBuilder().log();
    if (schemaDiff.upQueries.length > 0) {
      const migrationsTableName =
        dataSource.options.migrationsTableName ?? 'migrations';
      const hasMigrationHistory = await runner.hasTable(migrationsTableName);
      if (!hasMigrationHistory) {
        await repairSynchronizedSchema(dataSource, runner, schemaDiff);
        const remainingDiff = await dataSource.driver
          .createSchemaBuilder()
          .log();
        if (remainingDiff.upQueries.length > 0) {
          throw new Error(
            `Existing database schema still differs from this release after repair (${remainingDiff.upQueries.length} pending schema changes). Restore or repair the schema before baselining.`,
          );
        }
      } else {
        // A database with migration history must be repaired explicitly.
        // Marking it as migrated would conceal missing tables or columns.
        throw new Error(
          `Existing database schema differs from this release (${schemaDiff.upQueries.length} pending schema changes). Restore or repair the schema before baselining.`,
        );
      }
    }
    await executor.showMigrations(); // Creates the migration history table.
    await executor.insertMigration(initial);
    return true;
  } finally {
    await runner.release();
  }
}

/**
 * Collect the names of the table-level UNIQUE constraints the current
 * entities declare. Constraints missing from this set are considered stray
 * legacy artifacts during a SQLite schema repair.
 */
function entityUniqueConstraintNames(dataSource: DataSource): Set<string> {
  const names = new Set<string>();
  for (const metadata of dataSource.entityMetadatas) {
    for (const unique of metadata.uniques) {
      if (unique.name) names.add(unique.name);
    }
  }
  return names;
}

const STRAY_UNIQUE_CONSTRAINT =
  /, CONSTRAINT "(UQ_[0-9a-f]+)" UNIQUE \([^)]+\)/g;

/**
 * TypeORM's SQLite table-rebuild statements carry over table-level UNIQUE
 * constraints that exist in the database but are no longer declared by the
 * current entities (left behind by the pre-1.9 `@Column({ unique: true })`
 * declarations, later replaced with unique indexes). Keeping them would make
 * the diff diverge forever: every synchronize run rebuilds the table with the
 * same stray constraints embedded. Strip the ones the entities do not declare
 * so the rebuild converges to the entity-defined schema.
 */
function stripStrayUniqueConstraints(
  sql: string,
  entityUniques: Set<string>,
): string {
  if (!sql.startsWith('CREATE TABLE "temporary_')) return sql;
  return sql.replace(STRAY_UNIQUE_CONSTRAINT, (match, name: string) =>
    entityUniques.has(name) ? match : '',
  );
}

/**
 * One-off repair for a database created by the old synchronize
 * configuration. Applies the pending schema diff, preserving all data: tables
 * are rebuilt through the full column list, and a rebuild is rejected up
 * front when the database holds columns the current entities do not define.
 *
 * On SQLite the repair runs inside one transaction with foreign-key checks
 * disabled, mirroring TypeORM's own table-rebuild behavior; the diff may drop
 * and recreate indexes to converge the legacy stray-constraint drift.
 *
 * On MySQL the DDL commits implicitly and cannot be rolled back, so the
 * repair is restricted to additive statements (CREATE TABLE / CREATE INDEX /
 * ALTER TABLE ... ADD); any DROP statement fails closed and requires an
 * explicit, data-preserving migration instead. This still lets a MySQL
 * database left half-initialized by older releases (see the TEXT-default
 * failure) complete its missing tables automatically.
 */
async function repairSynchronizedSchema(
  dataSource: DataSource,
  runner: QueryRunner,
  schemaDiff: SchemaDiff,
): Promise<void> {
  // Refuse to repair if any entity table has columns that the current
  // entities do not define — the rebuild would drop them and their data.
  // Require an explicit, data-preserving migration instead.
  for (const metadata of dataSource.entityMetadatas) {
    if (!metadata.synchronize || metadata.tableType !== 'regular') continue;
    const table = await runner.getTable(metadata.tablePath);
    if (!table) continue;
    const entityColumns = new Set(
      metadata.columns.map((column) => column.databaseName),
    );
    for (const dbColumn of table.columns) {
      if (!entityColumns.has(dbColumn.name)) {
        throw new Error(
          `Table "${metadata.tableName}" has column "${dbColumn.name}" that is not defined in the current entities. Repairing the schema would drop this column and its data. Remove the column manually or add a data-preserving migration before baselining.`,
        );
      }
    }
  }

  const entityUniques = entityUniqueConstraintNames(dataSource);
  const queries = schemaDiff.upQueries.map((query) => ({
    ...query,
    query: stripStrayUniqueConstraints(query.query, entityUniques),
  }));

  if (dataSource.options.type === 'mysql') {
    // MySQL DDL is non-transactional; only apply additive changes so a
    // failure can be retried safely and no data can be lost.
    for (const query of queries) {
      if (/^\s*DROP\s/i.test(query.query)) {
        throw new Error(
          `Repairing this MySQL database requires destructive statements (for example: ${query.query}). Restore or repair the schema manually, or add a data-preserving migration, before baselining.`,
        );
      }
    }
    for (const query of queries) {
      await runner.query(query.query, query.parameters);
    }
    return;
  }

  // SQLite: rebuilding parent tables trips immediate foreign-key checks;
  // disable them for the duration, as TypeORM's own table rebuilds do.
  await runner.query('PRAGMA foreign_keys = OFF');
  try {
    await runner.startTransaction();
    try {
      for (const query of queries) {
        await runner.query(query.query, query.parameters);
      }
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
  } finally {
    await runner.query('PRAGMA foreign_keys = ON');
  }
}

/**
 * Bring the database schema up to date: baseline a legacy synchronized
 * database when needed, then run all pending migrations, failing when any
 * remain pending afterwards.
 */
export async function migrateDatabase(dataSource: DataSource): Promise<void> {
  await withMigrationLock(dataSource, async () => {
    await baselineExistingDatabase(dataSource);
    await dataSource.runMigrations({
      transaction: dataSource.options.type === 'sqlite' ? 'all' : 'none',
    });
    if (await dataSource.showMigrations()) {
      throw new Error('Database migrations remain pending');
    }
  });
}
