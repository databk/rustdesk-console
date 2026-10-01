import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { UpdateError } from '../errors';

export interface BackupCommand {
  executable: string;
  args: string[];
  input?: string;
  inputFile?: string;
  outputFile?: string;
  cwd?: string;
  home?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}
export type BackupCommandRunner = (command: BackupCommand) => Promise<string>;

/** SQL/密码不出现在 argv；stdout 可直接流入私有文件，stderr 永不返回。 */
export const runBackupCommand: BackupCommandRunner = async (command) => {
  let input: FileHandle | undefined;
  let output: FileHandle | undefined;
  try {
    if (command.inputFile) input = await fs.open(command.inputFile, 'r');
    if (command.outputFile)
      output = await fs.open(command.outputFile, 'wx', 0o600);
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(command.executable, command.args, {
        shell: false,
        windowsHide: true,
        cwd: command.cwd,
        // 不继承 MYSQL_PWD、MYSQL_TEST_LOGIN_FILE 或应用凭据。
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
          HOME: command.home,
          USERPROFILE: command.home,
        },
        stdio: [
          input?.fd ?? (command.input === undefined ? 'ignore' : 'pipe'),
          output?.fd ?? 'pipe',
          'pipe',
        ],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let failure: UpdateError | undefined;
      const stop = (code: string, message: string) => {
        failure ??= new UpdateError(code, message, 503);
        child.kill('SIGKILL');
      };
      const timer = setTimeout(
        () => stop('BACKUP_TOOL_TIMEOUT', 'A database backup tool timed out.'),
        command.timeoutMs ?? 120_000,
      );
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (command.maxOutputBytes ?? 8 * 1024 * 1024)) {
          stop(
            'BACKUP_TOOL_OUTPUT_LIMIT',
            'Database inspection exceeded its output limit.',
          );
        } else chunks.push(chunk);
      });
      // 持续消费但不保留含 SQL/凭据/业务数据的错误流。
      child.stderr?.on('data', () => undefined);
      child.stdin?.on('error', () => {
        failure ??= new UpdateError(
          'BACKUP_TOOL_INPUT_FAILED',
          'A database tool could not read its input.',
          503,
        );
      });
      child.once('error', () => {
        failure ??= new UpdateError(
          'BACKUP_TOOL_UNAVAILABLE',
          'A required database backup tool is unavailable.',
          503,
        );
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (code !== 0)
          reject(
            new UpdateError(
              'BACKUP_TOOL_FAILED',
              'A database backup or restore command failed.',
              503,
            ),
          );
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
      if (!input && command.input !== undefined)
        child.stdin?.end(command.input);
    });
    await output?.sync();
    return stdout;
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError(
      'BACKUP_IO_FAILED',
      'A private backup file could not be accessed.',
      503,
    );
  } finally {
    await input?.close();
    await output?.close();
  }
};
