import { runMigrationCommand } from './migration-command';

void runMigrationCommand(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
