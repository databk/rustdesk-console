import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixMySqlDefaultUserGroupIndex1790985600001 implements MigrationInterface {
  name = 'FixMySqlDefaultUserGroupIndex1790985600001';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'mysql') return;

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
    await queryRunner.query(
      'CREATE UNIQUE INDEX `UQ_user_groups_single_default` ON `user_groups` ((CASE WHEN `isDefault` = 1 THEN 1 ELSE NULL END))',
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Reverting the default-group index could invalidate existing groups; restore a database backup instead.',
      ),
    );
  }
}
