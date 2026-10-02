import { DataSource, MigrationExecutor } from 'typeorm';
import { InitialSchema1790985600000 } from '../migrations/1790985600000-InitialSchema';

const INITIAL_MIGRATION = new InitialSchema1790985600000().name;

/**
 * Adopt a database created by the old synchronize configuration only when its
 * schema already matches the current entities. This runs before any later
 * migrations and records only the initial migration as completed.
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

    // A partial or drifted database must be repaired explicitly. Marking it as
    // migrated would conceal missing tables or columns.
    const schemaDiff = await dataSource.driver.createSchemaBuilder().log();
    if (schemaDiff.upQueries.length > 0) {
      throw new Error(
        `Existing database schema differs from this release (${schemaDiff.upQueries.length} pending schema changes). Restore or repair the schema before baselining.`,
      );
    }
    await executor.showMigrations(); // Creates the migration history table.
    await executor.insertMigration(initial);
    return true;
  } finally {
    await runner.release();
  }
}

export async function migrateDatabase(dataSource: DataSource): Promise<void> {
  await baselineExistingDatabase(dataSource);
  await dataSource.runMigrations({
    transaction: dataSource.options.type === 'sqlite' ? 'all' : 'none',
  });
  if (await dataSource.showMigrations()) {
    throw new Error('Database migrations remain pending');
  }
}
