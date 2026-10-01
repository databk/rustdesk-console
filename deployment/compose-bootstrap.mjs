import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const services = {
  backend: 'rustdesk-console',
  web: 'rustdesk-console-web',
  updater: 'updater',
};
const repositories = {
  backend: 'databk/rustdesk-console',
  web: 'databk/rustdesk-console-web',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateContext(self, root) {
  check(
    typeof root === 'string' &&
      root.startsWith('/') &&
      root !== '/' &&
      !/[\0\r\n,:]/.test(root),
    'Set CONSOLE_INSTALL_DIR to an absolute local Linux project path.',
  );
  const labels = self.Config?.Labels ?? {};
  check(
    labels['com.docker.compose.service'] === services.updater,
    'Bootstrap must run in the standard updater service.',
  );
  check(
    labels['com.docker.compose.project.working_dir'] === root,
    'The configured installation directory differs from the actual Compose project.',
  );
  check(
    self.Mounts?.some(
      (mount) =>
        mount.Type === 'bind' &&
        mount.Source === root &&
        mount.Destination === root &&
        mount.RW,
    ),
    'The updater must mount the real host project at the identical absolute path.',
  );
  check(
    self.Mounts?.some(
      (mount) =>
        mount.Type === 'bind' &&
        mount.Source === root &&
        mount.Destination === '/install' &&
        mount.RW,
    ),
    'The installation mount does not match the host project.',
  );
  const files = (labels['com.docker.compose.project.config_files'] ?? '').split(
    ',',
  );
  check(
    files.length > 0 &&
      files.every(
        (file) => posix.isAbsolute(file) && posix.dirname(file) === root,
      ),
    'Compose configuration must be inside the recorded installation directory.',
  );
  const overrideFile = join(root, 'docker-compose.override.yml');
  check(
    files.includes(overrideFile),
    'The managed digest override must be part of normal Compose startup.',
  );
  const projectName = labels['com.docker.compose.project'];
  check(
    /^[a-z0-9][a-z0-9_-]*$/.test(projectName),
    'Invalid Compose project identity.',
  );
  return { files, overrideFile, projectName, projectDirectory: root };
}

export function checkService(
  config,
  container,
  component,
  context,
  configHash,
) {
  const service = services[component];
  const effective = config.services[service];
  check(
    effective &&
      !effective.build &&
      !effective.privileged &&
      !effective.profiles,
    'Managed services require normal image-based deployment without profiles or privileged mode.',
  );
  check(
    container.State?.Running,
    'All application services must be running before registration.',
  );
  const labels = container.Config.Labels;
  check(
    labels['com.docker.compose.project'] === context.projectName &&
      labels['com.docker.compose.service'] === service &&
      labels['com.docker.compose.project.working_dir'] ===
        context.projectDirectory &&
      labels['com.docker.compose.project.config_files'] ===
        context.files.join(','),
    'A running service belongs to a different Compose installation.',
  );
  check(
    labels['com.docker.compose.config-hash'] ===
      configHash.trim().split(/\s+/).at(-1),
    'Compose configuration or shell-only environment differs from the running service.',
  );
  if (component !== 'updater') {
    check(
      !container.Mounts.some(
        (mount) =>
          mount.Destination === '/var/run/docker.sock' ||
          mount.Source === context.projectDirectory ||
          mount.Source.startsWith(context.projectDirectory + '/updater-state'),
      ),
      'A business service has access to private deployment state.',
    );
  }
}

function loadRuntime() {
  const require = createRequire(import.meta.url);
  return {
    ...require('../dist/updater/io.js'),
    ...require('../dist/updater/catalog.js'),
    ...require('../dist/updater/installation.js'),
    ...require('../dist/updater/manifest.js'),
    ...require('../dist/updater/adapters/common.js'),
    ...require('../dist/updater/adapters/compose.js'),
  };
}

export async function bootstrap(
  runtime = loadRuntime(),
  // Programmatic qualification only; the CLI always uses code-owned repositories.
  sourceRepositories = repositories,
) {
  const root = process.env.SYSTEM_UPDATE_COMPOSE_ROOT;
  const installationFile = process.env.SYSTEM_UPDATE_INSTALLATION;
  check(
    root && installationFile === join(root, 'updater-state/installation.json'),
    'The standard installation paths are inconsistent.',
  );
  check(
    (await fs.realpath(root)) === root,
    'The installation directory must not be a symbolic link.',
  );
  const pendingFile = join(root, 'updater-state/bootstrap-pending.json');
  const run = async (args) =>
    (
      await runtime.runCommand('docker', args, { timeout: 300_000 })
    ).stdout.trim();
  const info = JSON.parse(await run(['info', '--format', '{{json .}}']));
  check(
    info.OSType === 'linux' &&
      !info.SecurityOptions?.some((value) => value.includes('rootless')) &&
      !process.env.DOCKER_HOST,
    'Managed Compose requires a local rootful Linux Docker daemon.',
  );
  const self = JSON.parse(await run(['inspect', process.env.HOSTNAME]))[0];
  const context = validateContext(self, root);
  const compose = (args) =>
    run([
      'compose',
      '--project-directory',
      root,
      '--project-name',
      context.projectName,
      ...context.files.flatMap((file) => ['--file', file]),
      ...args,
    ]);
  const inspect = async (service) => {
    const ids = await compose(['ps', '-a', '-q', service]);
    check(
      /^[a-f0-9]{12,64}$/.test(ids),
      'Exactly one instance of each managed service is required.',
    );
    return JSON.parse(await run(['inspect', ids]))[0];
  };
  let installation;
  let pending;
  try {
    installation = await runtime.loadInstallation(installationFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    pending = JSON.parse(await fs.readFile(pendingFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (installation && !pending) return installation;
  if (pending) {
    if (!installation && pending.installation) {
      runtime.validateInstallation(pending.installation);
      await runtime.atomicWrite(installationFile, pending.installation);
      installation = pending.installation;
    }
    check(
      installation && pending.installationId === installation.installationId,
      'An interrupted registration requires its original installation record.',
    );
    check(
      pending.backend === installation.current.backend.artifact.url &&
        pending.web === installation.current.web.artifact.url,
      'Registration evidence differs from the current installation.',
    );
  } else {
    const config = JSON.parse(await compose(['config', '--format', 'json']));
    const containers = {};
    for (const component of Object.keys(services)) {
      containers[component] = await inspect(services[component]);
      checkService(
        config,
        containers[component],
        component,
        context,
        await compose(['config', '--hash', services[component]]),
      );
    }
    check(
      containers.backend.Mounts.some(
        (mount) =>
          mount.Type === 'bind' &&
          mount.Source === join(root, 'data') &&
          mount.Destination === '/data' &&
          mount.RW,
      ),
      'Business data must be the recorded project data directory.',
    );
    for (const [suffix, destination] of [
      ['updater-ipc', '/run/rustdesk-console-updater'],
      ['updater-maintenance', '/var/lib/rustdesk-console-maintenance'],
    ]) {
      check(
        containers.backend.Mounts.some(
          (mount) =>
            mount.Type === 'bind' &&
            mount.Source === join(root, suffix) &&
            mount.Destination === destination &&
            !mount.RW,
        ),
        'Backend IPC and maintenance mounts must be read-only.',
      );
    }
    const networkNames = Object.keys(
      containers.updater.NetworkSettings.Networks,
    );
    const network = networkNames.find(
      (name) =>
        containers.backend.NetworkSettings.Networks[name] &&
        containers.web.NetworkSettings.Networks[name],
    );
    check(
      network && network !== 'host',
      'Managed services must share a project Docker network.',
    );
    const configurationFiles = {};
    for (const file of context.files.filter(
      (file) => file !== context.overrideFile,
    )) {
      const contents = await fs.readFile(file, 'utf8');
      check(
        !/^\s*(include|extends|env_file):/m.test(contents),
        'External Compose includes and env_file require explicit migration to the standard configuration.',
      );
      configurationFiles[file] = sha256(contents);
    }
    configurationFiles[join(root, '.env')] = sha256(
      await fs.readFile(join(root, '.env')),
    );
    // A nonempty user override is never replaced by installation registration.
    const overrideText = (await fs.readFile(context.overrideFile, 'utf8'))
      .replace(/^\s*#.*$/gm, '')
      .trim();
    check(
      /^services:\s*\{\s*\}$/.test(overrideText) ||
        /^\{\s*"services"\s*:\s*\{\s*\}\s*\}$/.test(overrideText),
      'The managed override is occupied; migrate user configuration to the base file first.',
    );
    const backendEnv = Object.fromEntries(
      containers.backend.Config.Env.map((item) => {
        const at = item.indexOf('=');
        return [item.slice(0, at), item.slice(at + 1)];
      }),
    );
    check(
      !backendEnv.DATA_DIR || backendEnv.DATA_DIR === '/data',
      'The backend data directory differs from the standard mount.',
    );
    const backendPort = backendEnv.PORT || '3000';
    check(
      /^\d{2,5}$/.test(backendPort) && Number(backendPort) <= 65535,
      'Invalid backend port.',
    );
    const healthUrls = {
      backend:
        'http://' +
        services.backend +
        ':' +
        backendPort +
        '/api/system-update/health',
      web: 'http://' + services.web + '/system-update-health.json',
    };
    const current = {};
    const catalog = new runtime.OfficialCatalog();
    for (const component of ['backend', 'web']) {
      const health = await runtime.readHealth(healthUrls[component]);
      check(
        health.component === component &&
          health.ready &&
          health.maintenanceProtocol === 1 &&
          runtime.STABLE_VERSION.test(health.version),
        'The running applications require manual migration to the updater baseline.',
      );
      let release;
      for (const tag of [health.version, 'v' + health.version]) {
        try {
          release = JSON.parse(
            (
              await runtime.officialFetch(
                'https://api.github.com/repos/' +
                  sourceRepositories[component] +
                  '/releases/tags/' +
                  tag,
              )
            ).toString('utf8'),
          );
          break;
        } catch (error) {
          if (error.code !== 'RELEASE_UNAVAILABLE') throw error;
        }
      }
      check(release, 'The running version has no official release.');
      const manifest = await catalog.exact(component, release.id);
      check(
        manifest.version === health.version &&
          manifest.sourceCommit === health.sourceCommit,
        'Runtime build identity differs from the official release.',
      );
      const artifact = manifest.artifacts.find(
        (item) =>
          item.kind === 'oci' &&
          item.platform.os === 'linux' &&
          item.platform.arch === process.arch &&
          item.platform.libc === 'musl',
      );
      check(
        artifact,
        'The official release is missing the current Docker platform.',
      );
      const image = JSON.parse(
        await run(['image', 'inspect', containers[component].Image]),
      )[0];
      check(
        image.RepoDigests?.some((reference) =>
          [
            sourceRepositories[component],
            'ghcr.io/' + sourceRepositories[component],
          ].some(
            (repository) =>
              reference === repository + '@sha256:' + artifact.sha256,
          ),
        ),
        'The running image is not the official immutable release.',
      );
      // Register the SAME content under its canonical official registry reference.
      // This does not discover or install a newer version.
      await run(['pull', artifact.url]);
      const canonicalImage = JSON.parse(
        await run(['image', 'inspect', artifact.url]),
      )[0];
      check(
        canonicalImage.Id === containers[component].Image &&
          canonicalImage.RepoDigests?.includes(artifact.url),
        'The canonical release digest differs from the running image.',
      );
      current[component] = {
        version: manifest.version,
        sourceCommit: manifest.sourceCommit,
        artifact,
        manifest,
      };
    }
    check(
      containers.updater.Image === containers.backend.Image,
      'The updater must use the same immutable backend image.',
    );
    const databaseType = backendEnv.DB_TYPE?.trim().toLowerCase() || 'sqlite';
    check(
      ['sqlite', 'mysql'].includes(databaseType),
      'The application database type is unsupported.',
    );
    const database =
      databaseType === 'mysql'
        ? {
            kind: 'mysql',
            host: backendEnv.DB_HOST || 'localhost',
            port: Number(backendEnv.DB_PORT || '3306'),
            database: backendEnv.DB_DATABASE || 'rustdesk_console',
            username: backendEnv.DB_USERNAME || 'root',
            passwordFile: join(root, 'updater-state/mysql.password'),
            exclusiveSchema:
              backendEnv.SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA === 'true',
          }
        : { kind: 'sqlite', path: join(root, 'data/rustdesk-console.db') };
    if (database.kind === 'mysql') {
      try {
        const password = await fs.open(database.passwordFile, 'wx', 0o600);
        try {
          await password.writeFile(backendEnv.DB_PASSWORD || '');
          await password.sync();
        } finally {
          await password.close();
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        check(
          (await fs.readFile(database.passwordFile, 'utf8')) ===
            (backendEnv.DB_PASSWORD || ''),
          'The registered database credential changed during installation.',
        );
      }
    }
    installation = {
      schemaVersion: 1,
      installationId: randomUUID(),
      deployment: 'managed-compose',
      platform: { os: 'linux', arch: process.arch, libc: 'musl' },
      stateDir: join(root, 'updater-state'),
      ipcDir: join(root, 'updater-ipc'),
      maintenanceFile: join(root, 'updater-maintenance/maintenance.json'),
      dataDir: join(root, 'data'),
      backendHealthUrl: healthUrls.backend,
      webHealthUrl: healthUrls.web,
      current,
      database,
      compose: {
        ...context,
        configFiles: configurationFiles,
        configDigest: runtime.configurationFingerprint(
          config,
          Object.values(services),
        ),
        services,
        workerMounts: [{ source: root, target: root, readOnly: false }],
        workerNetwork: network,
        workerImage: current.backend.artifact.url,
      },
    };
    runtime.validateInstallation(installation);
    pending = {
      installationId: installation.installationId,
      backend: current.backend.artifact.url,
      web: current.web.artifact.url,
      installation,
    };
    await runtime.atomicWrite(pendingFile, pending);
    await runtime.atomicWrite(installationFile, installation);
  }
  await runtime.atomicWrite(
    context.overrideFile,
    {
      services: {
        [services.backend]: { image: pending.backend },
        [services.web]: { image: pending.web },
        [services.updater]: { image: pending.backend },
      },
    },
    0o644,
  );
  check(
    runtime.configurationFingerprint(
      JSON.parse(await compose(['config', '--format', 'json'])),
      Object.values(services),
    ) === installation.compose.configDigest,
    'Registration would change non-image Compose configuration.',
  );
  for (const component of ['backend', 'web', 'updater']) {
    const container = await inspect(services[component]);
    const expected = component === 'web' ? pending.web : pending.backend;
    if (container.Config.Image !== expected && component === 'updater') {
      // Replacing this container must be supervised outside this process.
      const name =
        context.projectName + '-register-' + installation.installationId;
      const existing = await run([
        'ps',
        '-a',
        '--filter',
        'name=^/' + name + '$',
        '--format',
        '{{.ID}}',
      ]);
      if (existing) {
        const helper = JSON.parse(await run(['inspect', existing]))[0];
        check(
          helper.Config.Labels?.['io.rustdesk-console.registration'] ===
            installation.installationId,
          'An unrelated registration container owns the reserved name.',
        );
        if (!helper.State.Running) await run(['start', existing]);
      } else {
        await run([
          'run',
          '-d',
          '--name',
          name,
          '--restart=on-failure:3',
          '--label',
          'io.rustdesk-console.registration=' + installation.installationId,
          '--mount',
          'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
          '--mount',
          'type=bind,src=' + root + ',dst=' + root,
          '--entrypoint',
          'docker',
          pending.backend,
          'compose',
          '--project-directory',
          root,
          '--project-name',
          context.projectName,
          ...context.files.flatMap((file) => ['--file', file]),
          'up',
          '-d',
          '--no-deps',
          '--no-build',
          '--pull',
          'never',
          services.updater,
        ]);
      }
      return null;
    }
    if (container.Config.Image !== expected)
      await compose([
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        '--pull',
        'never',
        services[component],
      ]);
  }
  await fs.unlink(pendingFile);
  await runtime.syncDirectory(dirname(pendingFile));
  return installation;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const installation = await bootstrap();
    if (!installation) {
      process.once('SIGTERM', () => process.exit(0));
      process.once('SIGINT', () => process.exit(0));
      // A detached, immutable registration container is replacing this service.
      await new Promise(() => {
        setInterval(() => {}, 60_000);
      });
    }
    const child = spawn(
      process.execPath,
      ['/app/dist/main.js', '--system-update-mode=updater'],
      { stdio: 'inherit' },
    );
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.on(signal, () => child.kill(signal));
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
  } catch (error) {
    // Never log command output, environment snapshots, database values or tokens.
    console.error(
      'Updater registration unavailable: ' +
        (error.code && /^[A-Z_]+$/.test(error.code)
          ? error.code
          : 'verify the standard deployment and official release manifests.'),
    );
    process.exitCode = 1;
  }
}
