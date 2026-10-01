import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Installation } from './contracts';
import { validateInstallation } from './installation';
import { LinuxDeployment } from './adapters/linux';
import { CommandRunner, digest, readJson } from './io';
import { testHarness } from './testing';

describe('managed Linux configuration fingerprints', () => {
  let context: Awaited<ReturnType<typeof testHarness>>;
  let installation: Installation;
  const environment = process.env.SYSTEM_UPDATE_INSTALLATION;
  beforeEach(async () => {
    context = await testHarness();
    installation = structuredClone(context.installation);
    installation.deployment = 'managed-linux';
    installation.linux = {
      configFiles: Object.fromEntries(
        ['backend', 'web', 'updater'].map((name) => [
          `/etc/rustdesk-console/${name}.env`,
          'a'.repeat(64),
        ]),
      ),
      releasesDir: '/opt/rustdesk-console/releases',
      backendLink: '/opt/rustdesk-console/current-backend',
      webLink: '/opt/rustdesk-console/current-web',
      updaterLink: '/opt/rustdesk-console/current-updater',
      units: {
        backend: 'rustdesk-console-backend.service',
        web: 'rustdesk-console-web.service',
        updater: 'rustdesk-console-updater.service',
        job: 'rustdesk-console-update-job@.service',
      },
      executableRelativePath: {
        backend: 'rustdesk-console',
        web: 'rustdesk-console-web',
      },
    };
    process.env.SYSTEM_UPDATE_INSTALLATION = join(
      context.root,
      'installation.json',
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (environment === undefined)
      delete process.env.SYSTEM_UPDATE_INSTALLATION;
    else process.env.SYSTEM_UPDATE_INSTALLATION = environment;
    await context.cleanup();
  });

  test('requires each managed environment file, not merely three arbitrary paths', () => {
    expect(() => validateInstallation(installation)).not.toThrow();
    delete installation.linux!.configFiles['/etc/rustdesk-console/updater.env'];
    installation.linux!.configFiles['/etc/rustdesk-console/unrelated.env'] =
      'a'.repeat(64);
    expect(() => validateInstallation(installation)).toThrow(
      expect.objectContaining({ code: 'LINUX_CONFIGURATION_UNKNOWN' }),
    );
  });

  test.each([
    '/etc/rustdesk-console/../outside.env',
    '/etc/rustdesk-console/./backend.env',
    '/etc/rustdesk-console/config\0.env',
  ])('rejects noncanonical configuration path %s', (path) => {
    installation.linux!.configFiles[path] = 'a'.repeat(64);
    expect(() => validateInstallation(installation)).toThrow(
      expect.objectContaining({ code: 'LINUX_CONFIGURATION_UNKNOWN' }),
    );
  });

  test('requires credential and configured TLS fingerprints for MySQL', () => {
    installation.database = {
      kind: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'console',
      username: 'console',
      passwordFile: '/etc/rustdesk-console/mysql.password',
      exclusiveSchema: true,
      tls: {
        ca: '/etc/rustdesk-console/mysql-ca.pem',
        cert: '/etc/rustdesk-console/mysql-client.pem',
        key: '/etc/rustdesk-console/mysql-client.key',
        rejectUnauthorized: true,
      },
    };
    for (const path of [
      installation.database.passwordFile,
      installation.database.tls!.ca!,
      installation.database.tls!.cert!,
      installation.database.tls!.key!,
    ]) {
      expect(() => validateInstallation(installation)).toThrow(
        expect.objectContaining({ code: 'LINUX_CONFIGURATION_UNKNOWN' }),
      );
      installation.linux!.configFiles[path] = 'a'.repeat(64);
    }
    expect(() => validateInstallation(installation)).not.toThrow();
  });

  test('environment drift blocks preflight and commit before any service or installation mutation', async () => {
    const path = join(context.root, 'backend.env');
    await fs.writeFile(path, 'DATA_DIR=/var/lib/changed-data');
    installation.linux!.configFiles = {
      [path]: digest('DATA_DIR=/var/lib/original-data'),
    };
    const command = jest.fn<
      ReturnType<CommandRunner>,
      Parameters<CommandRunner>
    >();
    const deployment = new LinuxDeployment(installation, command);
    expect(await deployment.preflight()).toEqual([
      expect.objectContaining({ code: 'CONFIGURATION_DRIFT' }),
    ]);
    const view = await context.planner.create();
    await expect(
      deployment.commit(await context.store.plan(view.planId)),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_DRIFT' });
    expect(command).not.toHaveBeenCalled();
    await expect(
      fs.access(process.env.SYSTEM_UPDATE_INSTALLATION!),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('verified commit preserves config hashes and the frozen original installation', async () => {
    const path = join(context.root, 'backend.env');
    const contents = 'DATA_DIR=/var/lib/rustdesk-console';
    await fs.writeFile(path, contents);
    installation.linux!.configFiles = { [path]: digest(contents) };
    const before = structuredClone(installation);
    const deployment = new LinuxDeployment(installation);
    const view = await context.planner.create();
    await deployment.commit(await context.store.plan(view.planId));
    const committed = await readJson<Installation>(
      process.env.SYSTEM_UPDATE_INSTALLATION!,
    );
    expect(committed.current.backend.version).toBe('1.1.0');
    expect(committed.linux!.configFiles).toEqual(before.linux!.configFiles);
    expect(installation).toEqual(before);
    expect(await fs.readFile(path, 'utf8')).toBe(contents);
  });
});
