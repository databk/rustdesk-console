import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetTokens1790985600002 implements MigrationInterface {
  name = 'AddPasswordResetTokens1790985600002';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('password_reset_tokens')) {
      // A synchronized database can already contain the table (created by the
      // baseline repair); skip to keep the migration idempotent.
      return;
    }

    const type = queryRunner.connection.options.type;

    if (type === 'sqlite') {
      await queryRunner.query(
        'CREATE TABLE "password_reset_tokens" ("guid" varchar PRIMARY KEY NOT NULL, "token" varchar NOT NULL, "userGuid" varchar NOT NULL, "expiresAt" datetime NOT NULL, "usedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime(\'now\')), "updatedAt" datetime NOT NULL DEFAULT (datetime(\'now\')), CONSTRAINT "UQ_ab673f0e63eac966762155508ee" UNIQUE ("token"))',
      );
      await queryRunner.query(
        'CREATE INDEX "IDX_cdb3234dc1494961ee906cc1ac" ON "password_reset_tokens" ("userGuid") ',
      );
      return;
    }

    if (type === 'mysql') {
      await queryRunner.query(
        'CREATE TABLE `password_reset_tokens` (`guid` varchar(255) NOT NULL, `token` varchar(255) NOT NULL, `userGuid` varchar(255) NOT NULL, `expiresAt` datetime NOT NULL, `usedAt` datetime NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX `IDX_cdb3234dc1494961ee906cc1ac` (`userGuid`), UNIQUE INDEX `IDX_ab673f0e63eac966762155508e` (`token`), PRIMARY KEY (`guid`)) ENGINE=InnoDB',
      );
      return;
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('password_reset_tokens', true);
  }
}
