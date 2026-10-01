import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { digest, readJson } from '../io';
import { testArchive, testHarness, testRelease } from '../testing';
import { LinuxDeployment } from './linux';

describe('native release preparation space and cleanup', () => {
  let context: Awaited<ReturnType<typeof testHarness>>;
  let releases: string;
  beforeEach(async () => {
    context = await testHarness();
    if (process.platform === 'win32') {
      const lstat = fs.lstat;
      // NTFS 不提供 POSIX 执行位；只在 Windows 上补充该元数据，文件内容与目录操作仍是真实的。
      jest.spyOn(fs, 'lstat').mockImplementation(async (path) => {
        const stat = await lstat(path);
        if (
          String(path).endsWith(`${join('1.1.0', 'app')}`) ||
          /1\.1\.0\.staging\.[^/\\]+[/\\]app$/.test(String(path))
        )
          stat.mode |= 0o111;
        return stat;
      });
    }
    releases = join(context.root, 'releases');
    context.installation.deployment = 'managed-linux';
    context.catalog.latest.mockImplementation((component) => {
      const manifest = testRelease(component, '1.1.0').manifest;
      manifest.artifacts[0].kind = 'archive';
      return Promise.resolve(manifest);
    });
    context.installation.linux = {
      releasesDir: releases,
      backendLink: join(context.root, 'current-backend'),
      webLink: join(context.root, 'current-web'),
      updaterLink: join(context.root, 'current-updater'),
      configFiles: {},
      units: {
        backend: 'backend',
        web: 'web',
        updater: 'updater',
        job: 'job@.service',
      },
      executableRelativePath: { backend: 'app', web: 'web' },
    };
    await fs.mkdir(join(releases, 'backend', '1.0.0'), { recursive: true });
    await fs.writeFile(
      join(releases, 'backend', '1.0.0', 'keep'),
      'old release',
    );
    await fs.mkdir(join(releases, 'backend', 'other.staging.retained'));
    await fs.writeFile(
      join(releases, 'backend', 'other.staging.retained', 'keep'),
      'other evidence',
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await context.cleanup();
  });
  async function prepareFixture(valid: boolean) {
    const view = await context.planner.create();
    expect(view.executable).toBe(true);
    const plan = await context.store.plan(view.planId);
    plan.view.components = plan.view.components.filter(
      (item) => item.component === 'backend',
    );
    const archive = testArchive([
      {
        path: 'release-metadata.json',
        content: JSON.stringify({
          version: valid ? '1.1.0' : 'wrong',
          sourceCommit: plan.targets.backend.sourceCommit,
        }),
      },
      { path: 'app' },
    ]);
    plan.targets.backend.artifact = {
      ...plan.targets.backend.artifact,
      size: archive.length,
      sha256: digest(archive),
    };
    const command = jest.fn(() => Promise.resolve({ stdout: '', stderr: '' }));
    const download = jest.fn(() => Promise.resolve(archive));
    const deployment = new LinuxDeployment(
      context.installation,
      command,
      download,
    );
    // 本组测试只隔离部署身份检查；下载校验、解包、空间、发布与清理均执行真实实现。
    jest.spyOn(deployment, 'fingerprint').mockResolvedValue('fingerprint');
    return { deployment, plan, archive, command, download };
  }
  async function verifyRetained() {
    expect(
      await fs.readFile(join(releases, 'backend', '1.0.0', 'keep'), 'utf8'),
    ).toBe('old release');
    expect(
      await fs.readFile(
        join(releases, 'backend', 'other.staging.retained', 'keep'),
        'utf8',
      ),
    ).toBe('other evidence');
  }
  test('cleans only its unpublished staging directory after metadata rejection', async () => {
    const { deployment, plan, command } = await prepareFixture(false);
    await expect(deployment.prepare(plan)).rejects.toMatchObject({
      code: 'BUNDLE_VERSION_MISMATCH',
    });
    expect((await fs.readdir(join(releases, 'backend'))).sort()).toEqual([
      '1.0.0',
      'other.staging.retained',
    ]);
    expect(command).not.toHaveBeenCalled();
    await verifyRetained();
  });
  test('rejects actual insufficient space before service changes and cleans the empty staging directory', async () => {
    const fixture = await prepareFixture(true);
    const actual = await fs.statfs(releases);
    jest
      .spyOn(fs, 'statfs')
      .mockResolvedValue({ ...actual, bavail: 1, bsize: 4096 });
    await expect(
      fixture.deployment.prepare(fixture.plan),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_DISK' });
    expect((await fs.readdir(join(releases, 'backend'))).sort()).toEqual([
      '1.0.0',
      'other.staging.retained',
    ]);
    expect(fixture.command).not.toHaveBeenCalled();
    await verifyRetained();
  });
  test('keeps the primary error and retained evidence when staging cleanup is denied', async () => {
    const { deployment, plan, command } = await prepareFixture(false);
    const denied = Object.assign(new Error('cleanup denied'), {
      code: 'EACCES',
    });
    const remove = jest.spyOn(fs, 'rm').mockRejectedValue(denied);
    await expect(deployment.prepare(plan)).rejects.toMatchObject({
      code: 'BUNDLE_VERSION_MISMATCH',
    });
    const names = await fs.readdir(join(releases, 'backend'));
    const staging = names.filter((name) => name.startsWith('1.1.0.staging.'));
    expect(staging).toHaveLength(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(join(releases, 'backend', staging[0]), {
      recursive: true,
      force: true,
    });
    expect(command).not.toHaveBeenCalled();
    expect(
      await readJson(
        join(releases, 'backend', staging[0], 'release-metadata.json'),
      ),
    ).toMatchObject({ version: 'wrong' });
    await verifyRetained();
  });
  test('publishes one verified copy with limited space and reuses it without another download', async () => {
    const fixture = await prepareFixture(true);
    const actual = await fs.statfs(releases);
    jest.spyOn(fs, 'statfs').mockResolvedValue({
      ...actual,
      bavail: (64 * 1024 * 1024) / 4096,
      bsize: 4096,
    });
    await fixture.deployment.prepare(fixture.plan);
    const release = join(releases, 'backend', '1.1.0');
    expect(await fs.readFile(join(release, 'app'), 'utf8')).toBe('test');
    expect(await readJson(join(release, '.updater-integrity.json'))).toEqual({
      sha256: digest(fixture.archive),
    });
    await fixture.deployment.prepare(fixture.plan);
    expect(fixture.download).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(join(releases, 'backend'))).sort()).toEqual([
      '1.0.0',
      '1.1.0',
      'other.staging.retained',
    ]);
    await verifyRetained();
  });
});
