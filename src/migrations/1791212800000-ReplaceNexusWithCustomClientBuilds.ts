import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceNexusWithCustomClientBuilds1791212800000 implements MigrationInterface {
  name = 'ReplaceNexusWithCustomClientBuilds1791212800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const type = queryRunner.connection.options.type;

    // Drop legacy Nexus tables (replaced by the custom-client module).
    if (await queryRunner.hasTable('nexus_tokens')) {
      await queryRunner.dropTable('nexus_tokens');
    }
    if (await queryRunner.hasTable('nexus_builds')) {
      await queryRunner.dropTable('nexus_builds');
    }

    if (await queryRunner.hasTable('custom_client_builds')) {
      return;
    }

    if (type === 'sqlite') {
      await queryRunner.query(
        `CREATE TABLE "custom_client_builds" ("uuid" varchar PRIMARY KEY NOT NULL, "userGuid" varchar NOT NULL, "os" varchar NOT NULL, "arch" varchar NOT NULL, "custom" text, "status" varchar NOT NULL DEFAULT ('pending'), "message" text, "files" text, "callbackToken" varchar NOT NULL, "githubRunId" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_custom_client_builds_userGuid" ON "custom_client_builds" ("userGuid") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_custom_client_builds_status" ON "custom_client_builds" ("status") `,
      );
      return;
    }

    if (type === 'mysql') {
      await queryRunner.query(
        `CREATE TABLE \`custom_client_builds\` (\`uuid\` varchar(255) NOT NULL, \`userGuid\` varchar(255) NOT NULL, \`os\` varchar(255) NOT NULL, \`arch\` varchar(255) NOT NULL, \`custom\` text NULL, \`status\` varchar(255) NOT NULL DEFAULT 'pending', \`message\` varchar(255) NULL, \`files\` text NULL, \`callbackToken\` varchar(255) NOT NULL, \`githubRunId\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_custom_client_builds_userGuid\` (\`userGuid\`), INDEX \`IDX_custom_client_builds_status\` (\`status\`), PRIMARY KEY (\`uuid\`)) ENGINE=InnoDB`,
      );
      return;
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('custom_client_builds')) {
      await queryRunner.dropTable('custom_client_builds');
    }
  }
}
