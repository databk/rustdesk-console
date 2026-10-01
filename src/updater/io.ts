import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { UpdateError } from './errors';
export function digest(value: unknown): string {
  return createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest('hex');
}
export async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await fs.open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function atomicWrite(
  path: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', mode);
  try {
    await handle.chmod(mode);
    await handle.writeFile(JSON.stringify(value) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, path);
  await syncDirectory(dirname(path));
}
export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as T;
}
export function missing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
export interface CommandResult {
  stdout: string;
  stderr: string;
}
export type CommandRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;
/** 不启动 shell；命令失败不把包含环境或凭据的输出带入 API。 */
export const runCommand: CommandRunner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let total = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new UpdateError(
          'COMMAND_TIMEOUT',
          'A managed deployment operation timed out.',
          503,
        ),
      );
    }, options.timeout ?? 120_000);
    for (const [stream, append] of [
      [
        child.stdout,
        (value: string) => {
          stdout += value;
        },
      ],
      [
        child.stderr,
        (value: string) => {
          stderr += value;
        },
      ],
    ] as const) {
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > 8 * 1024 * 1024) child.kill('SIGKILL');
        else append(chunk.toString('utf8'));
      });
    }
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        new UpdateError(
          'COMMAND_UNAVAILABLE',
          'A required managed deployment tool is unavailable.',
          503,
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new UpdateError(
            'COMMAND_FAILED',
            'A managed deployment operation failed. The running state must be verified.',
            503,
          ),
        );
    });
  });
/** 内核文件锁跨 PID namespace 生效；父进程退出关闭管道后自动释放。 */
export async function acquireProcessLock(
  path: string,
): Promise<() => Promise<void>> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const child = spawn(
    'flock',
    ['--exclusive', '--nonblock', '--conflict-exit-code', '73', path, 'cat'],
    {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const token = randomUUID();
  let established = false;
  let released = false;
  child.on('exit', () => {
    if (established && !released) process.exit(1);
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new UpdateError(
          'OWNERSHIP_UNCERTAIN',
          'The kernel execution lock could not be established.',
        ),
      );
    }, 5000);
    child.once('error', () => {
      clearTimeout(timeout);
      reject(
        new UpdateError(
          'LOCK_UNAVAILABLE',
          'The installed kernel file-lock utility is unavailable.',
        ),
      );
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(
        new UpdateError(
          code === 73 ? 'CONCURRENT_EXECUTION' : 'LOCK_UNAVAILABLE',
          code === 73
            ? 'Another executor owns this installation.'
            : 'The installed execution lock utility failed.',
        ),
      );
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(token)) {
        clearTimeout(timeout);
        established = true;
        resolve();
      }
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      // flock 拒绝锁后会先关闭 stdin；以退出码区分占用和工具故障。
      if (error.code === 'EPIPE') return;
      clearTimeout(timeout);
      reject(
        new UpdateError(
          'LOCK_UNAVAILABLE',
          'The execution lock pipe is unavailable.',
        ),
      );
    });
    child.stdin.write(token + '\n');
  });
  return () =>
    new Promise<void>((resolve) => {
      released = true;
      child.once('exit', () => resolve());
      child.stdin.end();
    });
}
