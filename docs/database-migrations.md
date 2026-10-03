# Database migrations

The server uses TypeORM migrations for both SQLite and MySQL. It does not run
schema synchronization at startup. The application refuses to start while a
migration is pending.

## Deploy or upgrade

1. Stop writes and take a restorable database backup. For SQLite, stop the
   server and copy the database file in `DATA_DIR` (including any WAL files),
   or use SQLite's online backup API. For MySQL, use your normal consistent
   backup procedure and test a restore.
2. Deploy the new version and run **one** migration process before starting
   application instances:

   ```bash
   # Built from source
   node dist/main.js migrate

   # Standalone executable
   ./rustdesk-console migrate
   ```

3. Start the server. `node dist/main.js show-migrations` or
   `./rustdesk-console show-migrations` reports whether migrations remain.

The provided Docker image runs the migration command before starting its
single server process. For multiple replicas sharing MySQL, run a single
migration job first, set `DB_MIGRATE_ON_START=0` on every replica, and then
start the replicas. MySQL migration commands take an advisory lock so an
accidental concurrent run waits up to 120 seconds for the first to finish, then
fails if it cannot acquire the lock. SQLite deployments
should use one writer process.

MySQL deployments require version 8.0.13 or later for the functional unique
index that permits multiple ordinary user groups while enforcing a single
default group.

Existing databases created with `synchronize: true` are automatically
baselined. If the current schema differs from this release's entities (e.g.
due to column type, index, or foreign key differences from an older release
or a different database engine), the remaining schema changes are applied
once to align the database before recording the initial migration. Take a
backup before upgrading so the schema changes can be rolled back if needed.

MySQL schema changes can commit independently of a transaction. If a
migration fails, inspect the database and restore the backup if needed before
retrying. Treat migration `down` methods as reviewable recovery tools, not a
substitute for a backup. The initial schema migration deliberately cannot be
reverted because it would destroy all application data.

## Develop new migrations

After changing entities, generate a draft against a disposable copy of the
old schema, review the SQL and commit the migration alongside the code:

```bash
npm run migration:generate -- src/migrations/MeaningfulName
```

`DB_TYPE` selects SQLite or MySQL for the CLI data source. TypeORM generates
SQL for only the selected dialect; a committed migration must handle both
database types. Generate and review a draft for each dialect, then combine
them in one migration class using `queryRunner.connection.options.type`.
Register the new class in `src/database/data-source-options.ts`; the static
list ensures standalone executables contain every migration.
Preserve data explicitly when renaming columns or rebuilding SQLite tables.
Test the upgrade on copies with real data as well as on a fresh database.

Do not edit a migration that has been released. Add a new migration instead.
The entity list in `src/database/entities.ts` and data source options in
`src/database/data-source-options.ts` are shared by the server and CLI.
