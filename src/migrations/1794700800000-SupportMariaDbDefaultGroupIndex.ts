import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMariaDb, isMySqlFamily } from '../database/mysql-dialect';
import {
  USER_GROUP_DEFAULT_KEY_COLUMN,
  USER_GROUP_DEFAULT_KEY_INDEX,
} from '../database/schema-diff';

/**
 * Enforce a single default user group on MariaDB.
 *
 * MySQL 8.0.13+ uses a functional index for this (see
 * FixMySqlDefaultUserGroupIndex1790985600001) and SQLite uses a partial index.
 * MariaDB supports neither, so the CASE expression is materialized as a
 * persisted generated column and a plain unique index is created on it.
 *
 * TypeORM cannot model a generated column that no entity declares, but it does
 * read the generation expression of every generated column from its internal
 * `typeorm_metadata` table, which the schema builder only creates when an
 * entity declares one. Create the table and record the column here so schema
 * diffs keep working; see src/database/schema-diff.ts for the matching filter.
 *
 * MariaDB commits DDL immediately, so a failure can leave part of this
 * migration applied while its history row is still missing. Every step is
 * therefore idempotent and safe to retry.
 */
export class SupportMariaDbDefaultGroupIndex1794700800000 implements MigrationInterface {
  name = 'SupportMariaDbDefaultGroupIndex1794700800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!isMySqlFamily(queryRunner.connection.options.type)) return;
    if (!(await isMariaDb(queryRunner))) return;

    const database = await queryRunner.getCurrentDatabase();

    // Initialized first: on a retry `user_groups.isDefaultKey` may already
    // exist, and TypeORM's table inspection then queries this table.
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS `typeorm_metadata` (`type` varchar(255) NOT NULL, `database` varchar(255) NULL, `schema` varchar(255) NULL, `table` varchar(255) NULL, `name` varchar(255) NULL, `value` text NULL) ENGINE=InnoDB',
    );

    const table = await queryRunner.getTable('user_groups');
    if (!table) throw new Error('Missing user_groups table');
    if (
      table.indices.some(
        (index) => index.name === 'UQ_user_groups_single_default',
      )
    ) {
      await queryRunner.query(
        'DROP INDEX `UQ_user_groups_single_default` ON `user_groups`',
      );
    }

    const expression = 'CASE WHEN `isDefault` = 1 THEN 1 ELSE NULL END';
    if (
      !table.columns.some(
        (column) => column.name === USER_GROUP_DEFAULT_KEY_COLUMN,
      )
    ) {
      await queryRunner.query(
        `ALTER TABLE \`user_groups\` ADD COLUMN \`${USER_GROUP_DEFAULT_KEY_COLUMN}\` tinyint GENERATED ALWAYS AS (${expression}) PERSISTENT`,
      );
    }

    const indexRows = (await queryRunner.query(
      'SELECT `NON_UNIQUE`, `COLUMN_NAME` FROM `information_schema`.`STATISTICS` WHERE `TABLE_SCHEMA` = ? AND `TABLE_NAME` = ? AND `INDEX_NAME` = ?',
      [database, 'user_groups', USER_GROUP_DEFAULT_KEY_INDEX],
    )) as { NON_UNIQUE: number | string; COLUMN_NAME: string }[];
    if (indexRows.length === 0) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX \`${USER_GROUP_DEFAULT_KEY_INDEX}\` ON \`user_groups\` (\`${USER_GROUP_DEFAULT_KEY_COLUMN}\`)`,
      );
    } else if (
      indexRows.length !== 1 ||
      Number(indexRows[0].NON_UNIQUE) !== 0 ||
      indexRows[0].COLUMN_NAME !== USER_GROUP_DEFAULT_KEY_COLUMN
    ) {
      throw new Error(
        `Index ${USER_GROUP_DEFAULT_KEY_INDEX} on user_groups does not enforce a unique ${USER_GROUP_DEFAULT_KEY_COLUMN}; drop or repair it before migrating`,
      );
    }

    const existing = (await queryRunner.query(
      'SELECT 1 FROM `typeorm_metadata` WHERE `type` = ? AND `name` = ? AND `schema` = ? AND `table` = ?',
      [
        'GENERATED_COLUMN',
        USER_GROUP_DEFAULT_KEY_COLUMN,
        database,
        'user_groups',
      ],
    )) as unknown[];
    if (existing.length === 0) {
      await queryRunner.query(
        'INSERT INTO `typeorm_metadata` (`type`, `database`, `schema`, `table`, `name`, `value`) VALUES (?, ?, ?, ?, ?, ?)',
        [
          'GENERATED_COLUMN',
          database,
          database,
          'user_groups',
          USER_GROUP_DEFAULT_KEY_COLUMN,
          expression,
        ],
      );
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Reverting the default-group index could invalidate existing groups; restore a database backup instead.',
      ),
    );
  }
}
