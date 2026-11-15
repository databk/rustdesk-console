import { DataSource } from 'typeorm';
import { isMariaDb } from './mysql-dialect';

/**
 * Generated column and unique index created by
 * SupportMariaDbDefaultGroupIndex1794700800000 to enforce a single default user
 * group on MariaDB.
 */
export const USER_GROUP_DEFAULT_KEY_COLUMN = 'isDefaultKey';
export const USER_GROUP_DEFAULT_KEY_INDEX = 'UQ_user_groups_default_key';

const USER_GROUP_TABLE = 'user_groups';

export interface SchemaDiffQuery {
  query: string;
  parameters?: unknown[];
}

/**
 * TypeORM cannot model a generated column that is not declared by an entity, so
 * every MariaDB schema diff proposes dropping `user_groups.isDefaultKey`, the
 * unique index on it and the metadata row describing it. Drop only statements
 * about that column on that table (or about the index named after it); an
 * identically named column anywhere else stays visible.
 */
export function withoutManagedColumns(
  queries: SchemaDiffQuery[],
): SchemaDiffQuery[] {
  return queries.filter((query) => {
    const parameters = query.parameters ?? [];
    const mentions = (name: string) =>
      query.query.includes(name) || parameters.includes(name);

    if (mentions(USER_GROUP_DEFAULT_KEY_INDEX)) return false;
    return !(
      mentions(USER_GROUP_DEFAULT_KEY_COLUMN) && mentions(USER_GROUP_TABLE)
    );
  });
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
