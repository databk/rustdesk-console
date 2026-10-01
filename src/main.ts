import 'dotenv/config';
import { safeError } from './updater/errors';
import { waitForApplicationStart } from './updater/maintenance';

async function main(): Promise<void> {
  const mode = process.argv
    .find((value) => value.startsWith('--system-update-mode='))
    ?.split('=')[1];
  if (mode) {
    // 在加载业务模块和 TypeORM 前分派，助手不能连接或同步业务数据库。
    const { updaterMain } = await import('./updater/entrypoint.js');
    await updaterMain(mode);
    return;
  }
  await waitForApplicationStart();
  const { bootstrap } = await import('./application.js');
  await bootstrap();
}
void main().catch((error: unknown) => {
  const failure = safeError(error);
  process.stderr.write(failure.code + ': ' + failure.message + '\n');
  process.exitCode = 1;
});
