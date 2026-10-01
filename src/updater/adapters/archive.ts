import { promises as fs } from 'node:fs';
import { join, posix } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assert } from '../errors';
import { syncDirectory } from '../io';
const MAX_EXPANDED = 1024 * 1024 * 1024;
// 为目录元数据、完整性标记和同盘并发写入留出余量，不把归档安全上限当作容量需求。
const RELEASE_SPACE_RESERVE = 16 * 1024 * 1024;
export async function checkReleaseSpace(
  directory: string,
  fileSizes: readonly number[] = [],
  directoryCount = 0,
): Promise<void> {
  const space = await fs.statfs(directory);
  const required =
    fileSizes.reduce(
      (sum, size) => sum + Math.ceil(size / space.bsize) * space.bsize,
      0,
    ) +
    directoryCount * space.bsize +
    RELEASE_SPACE_RESERVE;
  const available = space.bavail * space.bsize;
  assert(
    available >= required,
    'INSUFFICIENT_DISK',
    `Release staging requires ${required} bytes; ${available} bytes are available on its filesystem (includes a 16 MiB safety reserve).`,
  );
}
const field = (header: Buffer, offset: number, length: number) =>
  header
    .subarray(offset, offset + length)
    .toString('utf8')
    .split('\0')[0];
function octal(value: string): number {
  assert(
    /^[0-7 ]*$/.test(value),
    'ARCHIVE_INVALID',
    'The release archive contains an unsupported numeric field.',
  );
  return parseInt(value.trim() || '0', 8);
}
/** 只展开普通文件与目录，拒绝设备、符号链接/硬链接和所有越界路径。 */
export async function extractArchive(
  archive: Buffer,
  destination: string,
): Promise<void> {
  const directories = new Set(['']);
  const entries: { path: string; content: Buffer; mode: number }[] = [];
  const bytes = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED });
  let offset = 0;
  let count = 0;
  const seen = new Set<string>();
  let extendedPath: string | undefined;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((value) => value === 0)) break;
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i];
    assert(
      checksum === octal(field(header, 148, 8)),
      'ARCHIVE_INVALID',
      'The release archive header checksum is invalid.',
    );
    const size = octal(field(header, 124, 12));
    const type = field(header, 156, 1);
    assert(
      Number.isSafeInteger(size) &&
        size >= 0 &&
        offset + size <= bytes.length &&
        ++count <= 50_000,
      'ARCHIVE_INVALID',
      'The release archive exceeds supported bounds.',
    );
    const content = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const attributes = content.toString('utf8');
      assert(
        attributes.length < 16_384,
        'ARCHIVE_INVALID',
        'The archive extension is too large.',
      );
      for (const line of attributes.split('\n').filter(Boolean)) {
        const match = /^\d+ ([^=]+)=(.*)$/.exec(line);
        assert(match, 'ARCHIVE_INVALID', 'Invalid archive extension.');
        assert(
          ['path', 'mtime', 'atime', 'ctime'].includes(match[1]),
          'ARCHIVE_INVALID',
          'Unsupported archive extension.',
        );
        if (match[1] === 'path') extendedPath = match[2];
      }
      continue;
    }
    if (type === 'L') {
      extendedPath = content.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    const prefix = field(header, 345, 155);
    const path =
      extendedPath ?? `${prefix ? prefix + '/' : ''}${field(header, 0, 100)}`;
    extendedPath = undefined;
    assert(
      !path.startsWith('/') &&
        !path.includes('\\') &&
        !path.includes('\0') &&
        !path.split('/').includes('..') &&
        !/^[A-Za-z]:/.test(path),
      'ARCHIVE_PATH_UNSAFE',
      'The release archive contains an unsafe path.',
    );
    const normalized = posix
      .normalize(path)
      .split('/')
      .filter((part) => part !== '.' && part !== '')
      .join('/');
    if (normalized === '.' || normalized === '') {
      assert(
        type === '5',
        'ARCHIVE_PATH_UNSAFE',
        'Invalid root archive entry.',
      );
      continue;
    }
    assert(
      !seen.has(normalized) && (type === '0' || type === '' || type === '5'),
      'ARCHIVE_PATH_UNSAFE',
      'Duplicate entries, links and special files are not supported in release bundles.',
    );
    seen.add(normalized);
    let parent = type === '5' ? normalized : posix.dirname(normalized);
    while (parent !== '.' && parent !== '') {
      directories.add(parent);
      parent = posix.dirname(parent);
    }
    if (type === '5') continue;
    const mode = octal(field(header, 100, 8)) & 0o111 ? 0o755 : 0o644;
    entries.push({ path: normalized, content, mode });
  }
  assert(
    count > 0 && !extendedPath,
    'ARCHIVE_INVALID',
    'The release archive is empty or incomplete.',
  );
  assert(
    entries.every((entry) => !directories.has(entry.path)),
    'ARCHIVE_PATH_UNSAFE',
    'A release archive file conflicts with a directory.',
  );
  // 全量校验后，按目标文件系统的分配块计算新增峰值；压缩包只在内存中，重命名不复制。
  await checkReleaseSpace(
    destination,
    entries.map((entry) => entry.content.length),
    directories.size,
  );
  const orderedDirectories = [...directories].sort(
    (left, right) => left.split('/').length - right.split('/').length,
  );
  for (const directory of orderedDirectories) {
    const path = join(destination, directory);
    await fs.mkdir(path, { recursive: true, mode: 0o755 });
    await fs.chmod(path, 0o755);
  }
  for (const entry of entries) {
    const handle = await fs.open(
      join(destination, entry.path),
      'wx',
      entry.mode,
    );
    try {
      await handle.chmod(entry.mode);
      await handle.writeFile(entry.content);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  for (const directory of orderedDirectories.reverse())
    await syncDirectory(join(destination, directory));
}
