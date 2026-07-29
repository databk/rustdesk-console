import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial Schema Migration
 * Creates all database tables with complete schema including foreign keys and indexes.
 * This migration represents the complete initial database schema.
 */
export class InitialSchema1785305180672 implements MigrationInterface {
  name = 'InitialSchema1785305180672';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Independent tables (no foreign key dependencies)
    await queryRunner.query(`
      CREATE TABLE "sysinfos" (
        "uuid" varchar PRIMARY KEY NOT NULL,
        "hostname" varchar,
        "username" varchar,
        "os" varchar,
        "cpu" varchar,
        "memory" varchar,
        "preset_username" varchar,
        "preset_strategy_name" varchar,
        "preset_device_group_name" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "strategies" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "note" text,
        "configOptions" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_c9ac805e6a43148f0647f543c29" UNIQUE ("name")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_c9ac805e6a43148f0647f543c2" ON "strategies" ("name")`);

    await queryRunner.query(`
      CREATE TABLE "connection_audits" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "deviceId" varchar(255) NOT NULL,
        "deviceUuid" text NOT NULL,
        "connId" varchar(255),
        "sessionId" varchar(255),
        "ip" varchar(45) NOT NULL,
        "action" varchar(10) NOT NULL,
        "peerId" varchar(255),
        "peerName" varchar(255),
        "type" integer NOT NULL DEFAULT (-1),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "requestedAt" datetime,
        "establishedAt" datetime,
        "closedAt" datetime,
        "note" varchar(256)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "file_audits" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "deviceId" varchar(255) NOT NULL,
        "deviceUuid" text NOT NULL,
        "peerId" varchar(255) NOT NULL,
        "type" integer NOT NULL,
        "path" text,
        "isFile" boolean NOT NULL,
        "clientIp" varchar(45) NOT NULL,
        "clientName" varchar(255) NOT NULL,
        "fileCount" integer NOT NULL,
        "files" json NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "alarm_audits" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "deviceId" varchar(255) NOT NULL,
        "deviceUuid" text NOT NULL,
        "typ" integer NOT NULL,
        "infoId" varchar(255),
        "infoIp" varchar(45) NOT NULL,
        "infoName" varchar(255),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "user_groups" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "normalizedName" varchar NOT NULL,
        "note" text,
        "isDefault" boolean NOT NULL DEFAULT (0),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_b22a3ef69f790c9b03ffb803bfa" UNIQUE ("normalizedName")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_b22a3ef69f790c9b03ffb803bf" ON "user_groups" ("normalizedName")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_user_groups_single_default" ON "user_groups" ("isDefault") WHERE "isDefault" = 1`);

    await queryRunner.query(`
      CREATE TABLE "oidc_providers" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "type" text NOT NULL DEFAULT ('oidc'),
        "issuer" varchar NOT NULL,
        "clientId" varchar NOT NULL,
        "clientSecret" varchar,
        "scope" varchar,
        "authorizationEndpoint" varchar,
        "tokenEndpoint" varchar,
        "userinfoEndpoint" varchar,
        "jwksUri" varchar,
        "enabled" boolean NOT NULL DEFAULT (1),
        "priority" integer NOT NULL DEFAULT (0),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_2399f67c42a46d6670b27338b4" ON "oidc_providers" ("name")`);

    await queryRunner.query(`
      CREATE TABLE "oidc_auth_states" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "code" varchar NOT NULL,
        "op" varchar NOT NULL,
        "providerType" text NOT NULL DEFAULT ('oidc'),
        "deviceId" varchar,
        "deviceUuid" varchar,
        "deviceInfo" text,
        "redirectUri" text,
        "state" text,
        "status" text NOT NULL DEFAULT ('pending'),
        "userGuid" varchar,
        "accessToken" varchar,
        "codeVerifier" text,
        "nonce" text,
        "frontendRedirectUrl" text,
        "expiresAt" datetime NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_dff6ad917f82c6817539f49791" ON "oidc_auth_states" ("code")`);
    await queryRunner.query(`CREATE INDEX "IDX_15643f36cf99bd1046a760646c" ON "oidc_auth_states" ("op")`);

    await queryRunner.query(`
      CREATE TABLE "system_settings" (
        "key" varchar PRIMARY KEY NOT NULL,
        "value" text NOT NULL,
        "category" varchar NOT NULL,
        "description" varchar,
        "isSensitive" boolean NOT NULL DEFAULT (0),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_b1b5bc664526d375c94ce9ad43" ON "system_settings" ("key")`);
    await queryRunner.query(`CREATE INDEX "IDX_797d199fff9037e5b231dc4ffb" ON "system_settings" ("category")`);

    await queryRunner.query(`
      CREATE TABLE "address_books" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "owner" varchar NOT NULL,
        "isPersonal" boolean NOT NULL DEFAULT (0),
        "isShared" boolean NOT NULL DEFAULT (0),
        "name" varchar,
        "note" text,
        "info" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "nexus_tokens" (
        "userGuid" varchar PRIMARY KEY NOT NULL,
        "nexusToken" text NOT NULL,
        "nexusUsername" varchar NOT NULL,
        "expiresAt" datetime NOT NULL,
        "currentUuid" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_82203a4749fdde33a9060753e7" ON "nexus_tokens" ("userGuid")`);

    // Tables with foreign key dependencies (ordered by dependency)
    await queryRunner.query(`
      CREATE TABLE "peers" (
        "uuid" varchar PRIMARY KEY NOT NULL,
        "id" varchar NOT NULL,
        "userGuid" varchar,
        "deviceGroupGuid" varchar,
        "strategyGuid" varchar,
        "note" varchar,
        "status" integer NOT NULL DEFAULT (1),
        "ver" integer NOT NULL,
        "modifiedAt" integer NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "lastHeartbeat" datetime,
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_e27f5e43da4701b83496fe359b9" FOREIGN KEY ("strategyGuid") REFERENCES "strategies" ("guid") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_359e577524ef710f1e16b6de2b8" FOREIGN KEY ("deviceGroupGuid") REFERENCES "device_groups" ("guid") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_ab6c529b67b0acf915add4322e" ON "peers" ("userGuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_359e577524ef710f1e16b6de2b" ON "peers" ("deviceGroupGuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_e27f5e43da4701b83496fe359b" ON "peers" ("strategyGuid")`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "username" varchar NOT NULL,
        "displayName" varchar,
        "email" varchar,
        "password" varchar,
        "note" varchar,
        "verifier" varchar,
        "status" integer NOT NULL DEFAULT (1),
        "isAdmin" boolean NOT NULL DEFAULT (0),
        "emailVerificationCode" varchar,
        "tfaSecret" varchar,
        "info" text,
        "thirdAuthType" varchar,
        "oidcSubject" varchar,
        "avatar" varchar,
        "strategyGuid" varchar,
        "userGroupGuid" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"),
        CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"),
        CONSTRAINT "UQ_6069281bb078ce8bfe6000221eb" UNIQUE ("oidcSubject"),
        CONSTRAINT "FK_62b51ade0ce9c40e06c3465f874" FOREIGN KEY ("strategyGuid") REFERENCES "strategies" ("guid") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_ab7ab1b7f0c82372ab08064f112" FOREIGN KEY ("userGroupGuid") REFERENCES "user_groups" ("guid") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_fe0bb3f6520ee0469504521e71" ON "users" ("username")`);
    await queryRunner.query(`CREATE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")`);
    await queryRunner.query(`CREATE INDEX "IDX_6069281bb078ce8bfe6000221e" ON "users" ("oidcSubject")`);
    await queryRunner.query(`CREATE INDEX "IDX_62b51ade0ce9c40e06c3465f87" ON "users" ("strategyGuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_ab7ab1b7f0c82372ab08064f11" ON "users" ("userGroupGuid")`);

    await queryRunner.query(`
      CREATE TABLE "user_tokens" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "userGuid" varchar NOT NULL,
        "jti" varchar(36) NOT NULL,
        "deviceId" varchar,
        "deviceUuid" varchar,
        "expiresAt" datetime NOT NULL,
        "isRevoked" boolean NOT NULL DEFAULT (0),
        "deviceOs" varchar,
        "deviceType" varchar,
        "deviceName" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_8d60c54ad272c1b5078f3cb86dc" FOREIGN KEY ("userGuid") REFERENCES "users" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_8d60c54ad272c1b5078f3cb86d" ON "user_tokens" ("userGuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_cf8bff5dc33a46985bf6b2071e" ON "user_tokens" ("jti")`);

    await queryRunner.query(`
      CREATE TABLE "invitations" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "token" varchar NOT NULL,
        "email" varchar NOT NULL,
        "name" varchar NOT NULL,
        "displayName" varchar,
        "userGroupGuid" varchar,
        "note" varchar,
        "userGuid" varchar,
        "expiresAt" datetime NOT NULL,
        "usedAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_e577dcf9bb6d084373ed3998509" UNIQUE ("token")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "address_book_tags" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "addressBookGuid" varchar NOT NULL,
        "name" varchar NOT NULL,
        "color" bigint NOT NULL DEFAULT (0),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_28ac1c09ecf9a5b918311008e56" FOREIGN KEY ("addressBookGuid") REFERENCES "address_books" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "address_book_peers" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "addressBookGuid" varchar NOT NULL,
        "deviceId" varchar NOT NULL,
        "hash" text,
        "password" text,
        "alias" varchar,
        "note" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_bcf8fa37522d5338200a5adc0f9" FOREIGN KEY ("addressBookGuid") REFERENCES "address_books" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "address_book_rules" (
        "guid" varchar NOT NULL,
        "addressBookGuid" varchar NOT NULL,
        "targetUserId" varchar,
        "targetGroupId" varchar,
        "rule" integer NOT NULL DEFAULT (1),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY ("guid", "addressBookGuid"),
        CONSTRAINT "FK_c00ccc9f827bedcdcff573aac3f" FOREIGN KEY ("targetGroupId") REFERENCES "user_groups" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_812f0ec8c35dee5e6388a3cbddf" FOREIGN KEY ("addressBookGuid") REFERENCES "address_books" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_0774a2f2e209686910e9bd13fa" ON "address_book_rules" ("targetUserId")`);
    await queryRunner.query(`CREATE INDEX "IDX_c00ccc9f827bedcdcff573aac3" ON "address_book_rules" ("targetGroupId")`);

    await queryRunner.query(`
      CREATE TABLE "address_book_peer_tags" (
        "peerGuid" varchar NOT NULL,
        "tagGuid" varchar NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY ("peerGuid", "tagGuid"),
        CONSTRAINT "FK_1fa1cb6f8a11c6688a83c5da0fa" FOREIGN KEY ("peerGuid") REFERENCES "address_book_peers" ("guid") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_a55915fc46903ac9da334ac14ed" FOREIGN KEY ("tagGuid") REFERENCES "address_book_tags" ("guid") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_1fa1cb6f8a11c6688a83c5da0f" ON "address_book_peer_tags" ("peerGuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_a55915fc46903ac9da334ac14e" ON "address_book_peer_tags" ("tagGuid")`);

    await queryRunner.query(`
      CREATE TABLE "device_groups" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "note" text,
        "strategyGuid" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_84d2dfcb096662dfe895555e13a" UNIQUE ("name"),
        CONSTRAINT "FK_236b551f94f22691a7bee4c97b3" FOREIGN KEY ("strategyGuid") REFERENCES "strategies" ("guid") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_84d2dfcb096662dfe895555e13" ON "device_groups" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_236b551f94f22691a7bee4c97b" ON "device_groups" ("strategyGuid")`);

    await queryRunner.query(`
      CREATE TABLE "device_group_user_permissions" (
        "deviceGroupGuid" varchar NOT NULL,
        "userGuid" varchar NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY ("deviceGroupGuid", "userGuid"),
        CONSTRAINT "FK_3e77483646900525f873826fb8d" FOREIGN KEY ("deviceGroupGuid") REFERENCES "device_groups" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_c9b546610bbe3dd19fc522a1386" FOREIGN KEY ("userGuid") REFERENCES "users" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_3e77483646900525f873826fb8" ON "device_group_user_permissions" ("deviceGroupGuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_c9b546610bbe3dd19fc522a138" ON "device_group_user_permissions" ("userGuid")`);

    await queryRunner.query(`
      CREATE TABLE "user_user_permissions" (
        "userGuid" varchar NOT NULL,
        "targetUserGuid" varchar NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY ("userGuid", "targetUserGuid"),
        CONSTRAINT "FK_1ab78c399f60b2a7e58aa8707fc" FOREIGN KEY ("userGuid") REFERENCES "users" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_8aa3b35e740139ee2abb538cfc0" FOREIGN KEY ("targetUserGuid") REFERENCES "users" ("guid") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_1ab78c399f60b2a7e58aa8707f" ON "user_user_permissions" ("userGuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_8aa3b35e740139ee2abb538cfc" ON "user_user_permissions" ("targetUserGuid")`);

    await queryRunner.query(`
      CREATE TABLE "login_sessions" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "userGuid" varchar NOT NULL,
        "method" varchar NOT NULL DEFAULT ('email'),
        "email" varchar,
        "code" varchar,
        "expiresAt" datetime NOT NULL,
        "used" boolean NOT NULL DEFAULT (0),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_a5b1783954d94b336a89a2f40d" ON "login_sessions" ("guid")`);
    await queryRunner.query(`CREATE INDEX "IDX_cbaf941cb752c16ae3c3137b71" ON "login_sessions" ("userGuid")`);

    await queryRunner.query(`
      CREATE TABLE "passkey_credentials" (
        "guid" varchar PRIMARY KEY NOT NULL,
        "userGuid" varchar NOT NULL,
        "credentialId" varchar NOT NULL,
        "credentialPublicKey" varchar NOT NULL,
        "counter" integer NOT NULL DEFAULT (0),
        "transports" varchar,
        "deviceType" varchar,
        "backedUp" boolean NOT NULL DEFAULT (0),
        "name" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "UQ_e5df58f68fe430aa62c9c2747a0" UNIQUE ("credentialId")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_d36839bce7302352eadea2e783" ON "passkey_credentials" ("userGuid")`);

    await queryRunner.query(`
      CREATE TABLE "active_connections" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "connId" integer NOT NULL,
        "deviceUuid" varchar NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_adf75288c21bc3145d9f5f9e6eb" FOREIGN KEY ("deviceUuid") REFERENCES "peers" ("uuid") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_c0dea39c6f7cf528fe1d8c352f" ON "active_connections" ("connId")`);
    await queryRunner.query(`CREATE INDEX "IDX_adf75288c21bc3145d9f5f9e6e" ON "active_connections" ("deviceUuid")`);

    await queryRunner.query(`
      CREATE TABLE "nexus_builds" (
        "uuid" varchar PRIMARY KEY NOT NULL,
        "userGuid" varchar NOT NULL,
        "os" varchar NOT NULL,
        "arch" varchar NOT NULL,
        "appName" varchar NOT NULL,
        "custom" text,
        "status" varchar NOT NULL DEFAULT ('pending'),
        "files" text,
        "message" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_8eed64bc9d10bf8956634c657a" ON "nexus_builds" ("uuid")`);
    await queryRunner.query(`CREATE INDEX "IDX_404dc7952f0eb6448b6aa7e28b" ON "nexus_builds" ("userGuid")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP INDEX "IDX_404dc7952f0eb6448b6aa7e28b"`);
    await queryRunner.query(`DROP INDEX "IDX_8eed64bc9d10bf8956634c657a"`);
    await queryRunner.query(`DROP TABLE "nexus_builds"`);

    await queryRunner.query(`DROP INDEX "IDX_adf75288c21bc3145d9f5f9e6e"`);
    await queryRunner.query(`DROP INDEX "IDX_c0dea39c6f7cf528fe1d8c352f"`);
    await queryRunner.query(`DROP TABLE "active_connections"`);

    await queryRunner.query(`DROP INDEX "IDX_d36839bce7302352eadea2e783"`);
    await queryRunner.query(`DROP TABLE "passkey_credentials"`);

    await queryRunner.query(`DROP INDEX "IDX_cbaf941cb752c16ae3c3137b71"`);
    await queryRunner.query(`DROP INDEX "IDX_a5b1783954d94b336a89a2f40d"`);
    await queryRunner.query(`DROP TABLE "login_sessions"`);

    await queryRunner.query(`DROP INDEX "IDX_8aa3b35e740139ee2abb538cfc"`);
    await queryRunner.query(`DROP INDEX "IDX_1ab78c399f60b2a7e58aa8707f"`);
    await queryRunner.query(`DROP TABLE "user_user_permissions"`);

    await queryRunner.query(`DROP INDEX "IDX_c9b546610bbe3dd19fc522a138"`);
    await queryRunner.query(`DROP INDEX "IDX_3e77483646900525f873826fb8"`);
    await queryRunner.query(`DROP TABLE "device_group_user_permissions"`);

    await queryRunner.query(`DROP INDEX "IDX_236b551f94f22691a7bee4c97b"`);
    await queryRunner.query(`DROP INDEX "IDX_84d2dfcb096662dfe895555e13"`);
    await queryRunner.query(`DROP TABLE "device_groups"`);

    await queryRunner.query(`DROP INDEX "IDX_a55915fc46903ac9da334ac14e"`);
    await queryRunner.query(`DROP INDEX "IDX_1fa1cb6f8a11c6688a83c5da0f"`);
    await queryRunner.query(`DROP TABLE "address_book_peer_tags"`);

    await queryRunner.query(`DROP INDEX "IDX_c00ccc9f827bedcdcff573aac3"`);
    await queryRunner.query(`DROP INDEX "IDX_0774a2f2e209686910e9bd13fa"`);
    await queryRunner.query(`DROP TABLE "address_book_rules"`);

    await queryRunner.query(`DROP TABLE "address_book_peers"`);

    await queryRunner.query(`DROP TABLE "address_book_tags"`);

    await queryRunner.query(`DROP TABLE "invitations"`);

    await queryRunner.query(`DROP INDEX "IDX_cf8bff5dc33a46985bf6b2071e"`);
    await queryRunner.query(`DROP INDEX "IDX_8d60c54ad272c1b5078f3cb86d"`);
    await queryRunner.query(`DROP TABLE "user_tokens"`);

    await queryRunner.query(`DROP INDEX "IDX_ab7ab1b7f0c82372ab08064f11"`);
    await queryRunner.query(`DROP INDEX "IDX_62b51ade0ce9c40e06c3465f87"`);
    await queryRunner.query(`DROP INDEX "IDX_6069281bb078ce8bfe6000221e"`);
    await queryRunner.query(`DROP INDEX "IDX_97672ac88f789774dd47f7c8be"`);
    await queryRunner.query(`DROP INDEX "IDX_fe0bb3f6520ee0469504521e71"`);
    await queryRunner.query(`DROP TABLE "users"`);

    await queryRunner.query(`DROP INDEX "IDX_e27f5e43da4701b83496fe359b"`);
    await queryRunner.query(`DROP INDEX "IDX_359e577524ef710f1e16b6de2b"`);
    await queryRunner.query(`DROP INDEX "IDX_ab6c529b67b0acf915add4322e"`);
    await queryRunner.query(`DROP TABLE "peers"`);

    await queryRunner.query(`DROP INDEX "IDX_82203a4749fdde33a9060753e7"`);
    await queryRunner.query(`DROP TABLE "nexus_tokens"`);

    await queryRunner.query(`DROP TABLE "address_books"`);

    await queryRunner.query(`DROP INDEX "IDX_797d199fff9037e5b231dc4ffb"`);
    await queryRunner.query(`DROP INDEX "IDX_b1b5bc664526d375c94ce9ad43"`);
    await queryRunner.query(`DROP TABLE "system_settings"`);

    await queryRunner.query(`DROP INDEX "IDX_15643f36cf99bd1046a760646c"`);
    await queryRunner.query(`DROP INDEX "IDX_dff6ad917f82c6817539f49791"`);
    await queryRunner.query(`DROP TABLE "oidc_auth_states"`);

    await queryRunner.query(`DROP INDEX "IDX_2399f67c42a46d6670b27338b4"`);
    await queryRunner.query(`DROP TABLE "oidc_providers"`);

    await queryRunner.query(`DROP INDEX "UQ_user_groups_single_default"`);
    await queryRunner.query(`DROP INDEX "IDX_b22a3ef69f790c9b03ffb803bf"`);
    await queryRunner.query(`DROP TABLE "user_groups"`);

    await queryRunner.query(`DROP TABLE "alarm_audits"`);
    await queryRunner.query(`DROP TABLE "file_audits"`);
    await queryRunner.query(`DROP TABLE "connection_audits"`);

    await queryRunner.query(`DROP INDEX "IDX_c9ac805e6a43148f0647f543c2"`);
    await queryRunner.query(`DROP TABLE "strategies"`);

    await queryRunner.query(`DROP TABLE "sysinfos"`);
  }
}
