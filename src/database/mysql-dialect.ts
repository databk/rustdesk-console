import { DataSource, QueryRunner } from 'typeorm';

/**
 * MySQL and MariaDB share a wire protocol and most of their SQL dialect, but
 * they are separate TypeORM drivers with separate schema introspection quirks.
 * Code that only cares about the shared parts should treat them the same.
 */
export function isMySqlFamily(type: string | undefined): boolean {
  return type === 'mysql' || type === 'mariadb';
}

/**
 * MariaDB speaks the MySQL protocol and this project can connect to both
 * through the MySQL driver, so the server has to be asked which implementation
 * it is.
 */
export async function isMariaDb(
  source: DataSource | QueryRunner,
): Promise<boolean> {
  const connection = source instanceof DataSource ? source : source.connection;
  if (!isMySqlFamily(connection.options.type)) return false;

  const rows = await connection.query<{ version?: string }[]>(
    'SELECT VERSION() AS version',
  );
  return /mariadb/i.test(rows[0]?.version ?? '');
}
