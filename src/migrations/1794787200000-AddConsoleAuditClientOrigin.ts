import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMySqlFamily } from '../database/mysql-dialect';

export class AddConsoleAuditClientOrigin1794787200000 implements MigrationInterface {
  name = 'AddConsoleAuditClientOrigin1794787200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('console_audits'))) {
      return;
    }

    const type = queryRunner.connection.options.type;

    if (type === 'sqlite') {
      if (!(await queryRunner.hasColumn('console_audits', 'clientIp')))
        await queryRunner.query(
          'ALTER TABLE "console_audits" ADD "clientIp" varchar(45)',
        );
      if (!(await queryRunner.hasColumn('console_audits', 'userAgent')))
        await queryRunner.query(
          'ALTER TABLE "console_audits" ADD "userAgent" varchar(512)',
        );
      return;
    }

    if (isMySqlFamily(type)) {
      if (!(await queryRunner.hasColumn('console_audits', 'clientIp')))
        await queryRunner.query(
          'ALTER TABLE `console_audits` ADD `clientIp` varchar(45) NULL',
        );
      if (!(await queryRunner.hasColumn('console_audits', 'userAgent')))
        await queryRunner.query(
          'ALTER TABLE `console_audits` ADD `userAgent` varchar(512) NULL',
        );
      return;
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('console_audits'))) {
      return;
    }
    if (await queryRunner.hasColumn('console_audits', 'userAgent'))
      await queryRunner.dropColumn('console_audits', 'userAgent');
    if (await queryRunner.hasColumn('console_audits', 'clientIp'))
      await queryRunner.dropColumn('console_audits', 'clientIp');
  }
}
