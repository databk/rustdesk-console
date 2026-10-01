import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testArchive } from '../testing';
import { checkReleaseSpace, extractArchive } from './archive';
function tar(path: string, type = '0'): Buffer {
  return testArchive([{ path, type }]);
}
describe('bounded release archive extraction', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'console-archive-test-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function available(bytes: number) {
    const actual = await fs.statfs(root);
    return jest.spyOn(fs, 'statfs').mockResolvedValue({
      ...actual,
      bsize: 4096,
      bavail: bytes / 4096,
    });
  }
  test('readiness and a small bundle work with 64 MiB free, below the former 2 GiB floor', async () => {
    await available(64 * 1024 * 1024);
    await checkReleaseSpace(root);
    await extractArchive(tar('./nested/application'), root);
    expect(await fs.readFile(join(root, 'nested/application'), 'utf8')).toBe(
      'test',
    );
  });
  test('counts allocation blocks for small files before creating any contents', async () => {
    const free = 16 * 1024 * 1024 + 2 * 4096;
    await available(free);
    await expect(
      extractArchive(testArchive([{ path: 'one' }, { path: 'two' }]), root),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_DISK',
      message: expect.stringContaining(
        `requires ${free + 4096} bytes; ${free} bytes are available`,
      ),
    });
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('validates later unsafe entries before writing earlier valid files', async () => {
    await expect(
      extractArchive(
        testArchive([{ path: 'valid' }, { path: '../escape' }]),
        root,
      ),
    ).rejects.toMatchObject({ code: 'ARCHIVE_PATH_UNSAFE' });
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('rejects file and parent-directory conflicts before extraction', async () => {
    await expect(
      extractArchive(
        testArchive([{ path: 'parent' }, { path: 'parent/file' }]),
        root,
      ),
    ).rejects.toMatchObject({ code: 'ARCHIVE_PATH_UNSAFE' });
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('extracts a regular full bundle file', async () => {
    await extractArchive(tar('./nested/application'), root);
    expect(await fs.readFile(join(root, 'nested', 'application'), 'utf8')).toBe(
      'test',
    );
  });
  test.each(['../escape', '/absolute', 'nested/../../escape', 'C:/escape'])(
    'rejects archive path %s',
    async (path) => {
      await expect(extractArchive(tar(path), root)).rejects.toMatchObject({
        code: 'ARCHIVE_PATH_UNSAFE',
      });
      expect(await fs.readdir(root)).toHaveLength(0);
    },
  );
  test.each(['1', '2', '3', '4', '6'])(
    'rejects link or special entry %s',
    async (type) => {
      await expect(
        extractArchive(tar('application', type), root),
      ).rejects.toMatchObject({ code: 'ARCHIVE_PATH_UNSAFE' });
    },
  );
});
