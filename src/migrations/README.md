# Migrations

This directory contains TypeORM migration files.

## Usage

```bash
# Generate a migration from entity changes
npm run migration:generate -- src/migrations/MigrationName

# Run pending migrations
npm run migration:run

# Revert the last migration
npm run migration:revert

# Show migration status
npm run migration:show

# Create an empty migration (for manual SQL)
npm run migration:create -- src/migrations/MigrationName
```

## SQLite Considerations

SQLite's ALTER TABLE only supports:
- Adding columns (ADD COLUMN)
- Renaming tables (RENAME TABLE)
- Renaming columns (RENAME COLUMN, SQLite >= 3.25.0)

**Not supported**: dropping columns, modifying column types/constraints.

When dropping columns or modifying column attributes, use the "rebuild table" pattern:
1. CREATE TABLE new_table (...)
2. INSERT INTO new_table SELECT ... FROM old_table
3. DROP TABLE old_table
4. ALTER TABLE new_table RENAME TO old_table

Always review generated migration SQL for SQLite compatibility before committing.
