import 'dotenv/config';
import { safeError } from './updater/errors';
import { waitForApplicationStart } from './updater/maintenance';

const mode = process.argv
  .find((value) => value.startsWith('--system-update-mode='))
  ?.split('=')[1];

async function main(): Promise<void> {
  if (process.argv[2] === 'self-test') {
    const { testNativeModules } =
      await import('./common/utils/native-self-test.js');
    await testNativeModules();
    return;
  }
  if (mode) {
    // Dispatch before loading TypeORM; updater processes never open the business database.
    const { updaterMain } = await import('./updater/entrypoint.js');
    await updaterMain(mode);
    return;
  }
  await waitForApplicationStart();
  const command = process.argv[2];
  if (
    command === 'migrate' ||
    command === 'baseline' ||
    command === 'show-migrations'
  ) {
    const { runMigrationCommand } =
      await import('./database/migration-command.js');
    await runMigrationCommand(
      command === 'migrate'
        ? 'run'
        : command === 'baseline'
          ? 'baseline'
          : 'show',
    );
    return;
  }
  const { bootstrap } = await import('./application.js');
  await bootstrap();
}
void main().catch((error: unknown) => {
  if (mode) {
    const failure = safeError(error);
    process.stderr.write(failure.code + ': ' + failure.message + '\n');
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
