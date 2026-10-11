import { MigrationInterface, QueryRunner } from 'typeorm';

const SQLITE_STATEMENTS = [
  'CREATE TABLE "server_nodes" ("guid" varchar PRIMARY KEY NOT NULL, "role" varchar NOT NULL, "name" varchar NOT NULL, "url" varchar NOT NULL, "managementToken" varchar NOT NULL, "status" varchar NOT NULL DEFAULT \'offline\', "lastCheckedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime(\'now\')), "updatedAt" datetime NOT NULL DEFAULT (datetime(\'now\')))',
  'CREATE INDEX "IDX_server_nodes_role" ON "server_nodes" ("role")',
  'CREATE TABLE "server_ban_policies" ("id" integer PRIMARY KEY NOT NULL, "deviceIds" text NOT NULL DEFAULT \'[]\', "ips" text NOT NULL DEFAULT \'[]\', "updatedAt" datetime NOT NULL DEFAULT (datetime(\'now\')))',
] as const;

const MYSQL_STATEMENTS = [
  'CREATE TABLE `server_nodes` (`guid` varchar(255) NOT NULL, `role` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `url` varchar(255) NOT NULL, `managementToken` varchar(255) NOT NULL, `status` varchar(255) NOT NULL DEFAULT \'offline\', `lastCheckedAt` datetime NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX `IDX_server_nodes_role` (`role`), PRIMARY KEY (`guid`)) ENGINE=InnoDB',
  'CREATE TABLE `server_ban_policies` (`id` int NOT NULL, `deviceIds` text NOT NULL, `ips` text NOT NULL, `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)) ENGINE=InnoDB',
] as const;

export class AddServerNodes1790985600002 implements MigrationInterface {
  name = 'AddServerNodes1790985600002';

  async up(queryRunner: QueryRunner): Promise<void> {
    const type = queryRunner.connection.options.type;
    const statements =
      type === 'sqlite'
        ? SQLITE_STATEMENTS
        : type === 'mysql'
          ? MYSQL_STATEMENTS
          : null;
    if (!statements) throw new Error(`Unsupported database type: ${type}`);
    for (const statement of statements) {
      await queryRunner.query(statement);
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Dropping server management tables is not reversible; restore a database backup instead.',
      ),
    );
  }
}