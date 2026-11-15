import { DataSource } from 'typeorm';
import { isMariaDb } from './mysql-dialect';

/**
 * Generated column and unique index created by
 * SupportMariaDbDefaultGroupIndex1794700800000 to enforce a single default user
 * group on MariaDB.
 */
export const USER_GROUP_DEFAULT_KEY_COLUMN = 'isDefaultKey';
export const USER_GROUP_DEFAULT_KEY_INDEX = 'UQ_user_groups_default_key';

const MANAGED_NAMES = [
  USER_GROUP_DEFAULT_KEY_COLUMN,
  USER_GROUP_DEFAULT_KEY_INDEX,
];

export interface SchemaDiffQuery {
  query: string;
  parameters?: unknown[];
}

/**
 * TypeORM cannot model a generated column that is not declared by an entity, so
 * every MariaDB schema diff proposes dropping `user_groups.isDefaultKey`, the
 * unique index on it and the metadata row describing it. Drop only those
 * statements from the diff; everything else is still reported.
 */
export function withoutManagedColumns(
  queries: SchemaDiffQuery[],
): SchemaDiffQuery[] {
  return queries.filter(
    (query) =>
      !MANAGED_NAMES.some((name) => query.query.includes(name)) &&
      !MANAGED_NAMES.some((name) => (query.parameters ?? []).includes(name)),
  );
}

/**
 * Schema changes required to bring the database in line with the entities.
 * The managed MariaDB column is filtered only on MariaDB: anywhere else a
 * column with that name is foreign and must stay visible in the diff.
 */
export async function schemaDiffQueries(
  dataSource: DataSource,
): Promise<SchemaDiffQuery[]> {
  const { upQueries } = await dataSource.driver.createSchemaBuilder().log();
  if (!(await isMariaDb(dataSource))) return upQueries;
  return withoutManagedColumns(upQueries);
}
