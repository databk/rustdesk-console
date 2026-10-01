import { promises as fs } from 'node:fs';
import childProcess from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBackupCommand } from './process';

describe('backup subprocess boundary', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(
      join(tmpdir(), 'console-backup-process-test-'),
    );
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('passes literal argv without shell evaluation and excludes inherited credentials', async () => {
    const previous = process.env.MYSQL_PWD;
    process.env.MYSQL_PWD = 'secret-sentinel';
    try {
      const result = await runBackupCommand({
        executable: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify([process.argv[1],process.env.MYSQL_PWD ?? null]))',
          '$(echo must-not-run); & literal',
        ],
      });
      expect(JSON.parse(result)).toEqual([
        '$(echo must-not-run); & literal',
        null,
      ]);
    } finally {
      if (previous === undefined) delete process.env.MYSQL_PWD;
      else process.env.MYSQL_PWD = previous;
    }
  });
  it('does not write an empty stdin pipe to short-lived version probes', async () => {
    const spawn = jest.spyOn(childProcess, 'spawn');
    try {
      expect(
        await runBackupCommand({
          executable: process.execPath,
          args: ['--version'],
        }),
      ).toMatch(/^v/);
      expect(spawn.mock.calls[0][2]?.stdio?.[0]).toBe('ignore');
    } finally {
      spawn.mockRestore();
    }
  });
  it('streams dump and restore inputs without buffering the database in memory', async () => {
    const dump = join(directory, 'database.sql');
    await runBackupCommand({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(Buffer.alloc(2*1024*1024,65))'],
      outputFile: dump,
      maxOutputBytes: 16,
    });
    expect((await fs.stat(dump)).size).toBe(2 * 1024 * 1024);
    const restored = await runBackupCommand({
      executable: process.execPath,
      args: [
        '-e',
        'let n=0;process.stdin.on("data",c=>n+=c.length);process.stdin.on("end",()=>process.stdout.write(String(n)))',
      ],
      inputFile: dump,
    });
    expect(restored).toBe(String(2 * 1024 * 1024));
  });
  it('does not expose stderr secrets after a command fails', async () => {
    await expect(
      runBackupCommand({
        executable: process.execPath,
        args: [
          '-e',
          'process.stderr.write("password-secret SQL-sensitive");process.exit(4)',
        ],
      }),
    ).rejects.toMatchObject({
      code: 'BACKUP_TOOL_FAILED',
      message: 'A database backup or restore command failed.',
    });
  });
  it('kills overlong or oversized inspection and cannot report success on exit zero', async () => {
    await expect(
      runBackupCommand({
        executable: process.execPath,
        args: ['-e', 'setInterval(()=>{},1000)'],
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_TOOL_TIMEOUT' });
    await expect(
      runBackupCommand({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("too much data")'],
        maxOutputBytes: 2,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_TOOL_OUTPUT_LIMIT' });
  });
  it('returns a bounded unavailable-tool error', async () => {
    await expect(
      runBackupCommand({
        executable: join(directory, 'missing-client'),
        args: [],
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_TOOL_UNAVAILABLE' });
  });
});
