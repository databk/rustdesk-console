import { promises as fs } from 'node:fs';
import { isAbsolute, posix, resolve } from 'node:path';
import { Installation } from './contracts';
import { assert } from './errors';
import { readJson } from './io';
import { UUID } from './store';
import { STABLE_VERSION, assertArtifact } from './manifest';
export const installationPath = () =>
  process.env.SYSTEM_UPDATE_INSTALLATION ??
  '/etc/rustdesk-console/installation.json';
export function validateInstallation(installation: Installation): void {
  assert(
    installation?.schemaVersion === 1 && UUID.test(installation.installationId),
    'INSTALLATION_INVALID',
    'The managed installation record is invalid.',
  );
  assert(
    ['managed-compose', 'managed-linux'].includes(installation.deployment),
    'DEPLOYMENT_UNSUPPORTED',
    'This deployment is not a managed installation.',
  );
  assert(
    installation.platform?.os === 'linux' &&
      ['x64', 'arm64'].includes(installation.platform.arch) &&
      ['glibc', 'musl'].includes(installation.platform.libc),
    'PLATFORM_UNSUPPORTED',
    'This Linux platform is unsupported.',
  );
  for (const value of [
    installation.stateDir,
    installation.ipcDir,
    installation.maintenanceFile,
    installation.dataDir,
  ])
    assert(
      typeof value === 'string' && isAbsolute(value) && !value.includes('\0'),
      'INSTALLATION_INVALID',
      'The managed installation contains an invalid path.',
    );
  const data = resolve(installation.dataDir);
  const state = resolve(installation.stateDir);
  assert(
    data !== state &&
      !state.startsWith(data + '/') &&
      !data.startsWith(state + '/'),
    'STATE_NOT_ISOLATED',
    'Updater state must be outside the business recovery set.',
  );
  for (const component of ['backend', 'web'] as const) {
    const current = installation.current?.[component];
    assert(
      current &&
        STABLE_VERSION.test(current.version) &&
        current.manifest?.version === current.version &&
        current.manifest.sourceCommit === current.sourceCommit &&
        /^[a-f0-9]{40}$/.test(current.sourceCommit),
      'CURRENT_VERSION_UNKNOWN',
      'The installed component version cannot be proved.',
    );
    assert(
      current.manifest.updaterProtocol === 1 &&
        current.manifest.maintenanceProtocol === 1 &&
        current.manifest.bundleFormat === 1,
      'BOOTSTRAP_REQUIRED',
      'This installation requires manual migration to the updater baseline.',
    );
    assertArtifact(current.artifact, component, current.manifest.tag);
  }
  assert(
    installation.database &&
      ['sqlite', 'mysql'].includes(installation.database.kind),
    'DATABASE_UNSUPPORTED',
    'The managed database configuration is invalid.',
  );
  for (const health of [
    installation.backendHealthUrl,
    installation.webHealthUrl,
  ]) {
    const url = new URL(health);
    assert(
      ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password,
      'INSTALLATION_INVALID',
      'The managed health endpoint is invalid.',
    );
  }
  if (installation.deployment === 'managed-linux') {
    const linux = installation.linux;
    const requiredConfigs = [
      '/etc/rustdesk-console/backend.env',
      '/etc/rustdesk-console/web.env',
      '/etc/rustdesk-console/updater.env',
    ];
    if (installation.database.kind === 'mysql') {
      requiredConfigs.push(installation.database.passwordFile);
      for (const path of [
        installation.database.tls?.ca,
        installation.database.tls?.cert,
        installation.database.tls?.key,
      ])
        if (path) requiredConfigs.push(path);
    }
    assert(
      linux?.configFiles &&
        requiredConfigs.every((path) =>
          Object.prototype.hasOwnProperty.call(linux.configFiles, path),
        ) &&
        Object.entries(linux.configFiles).every(
          ([path, hash]) =>
            path.startsWith('/etc/rustdesk-console/') &&
            !path.includes('\0') &&
            posix.normalize(path) === path &&
            /^[a-f0-9]{64}$/.test(hash),
        ),
      'LINUX_CONFIGURATION_UNKNOWN',
      'Managed environment file fingerprints are required before automatic updating.',
    );
    assert(
      linux &&
        linux.releasesDir === '/opt/rustdesk-console/releases' &&
        linux.backendLink === '/opt/rustdesk-console/current-backend' &&
        linux.webLink === '/opt/rustdesk-console/current-web' &&
        linux.updaterLink === '/opt/rustdesk-console/current-updater',
      'LINUX_LAYOUT_UNSUPPORTED',
      'The installation does not use the official Linux layout.',
    );
    assert(
      linux.units.backend === 'rustdesk-console-backend.service' &&
        linux.units.web === 'rustdesk-console-web.service' &&
        linux.units.updater === 'rustdesk-console-updater.service' &&
        linux.units.job === 'rustdesk-console-update-job@.service',
      'LINUX_UNITS_UNSUPPORTED',
      'Only the installed official service units can be managed.',
    );
    for (const path of Object.values(linux.executableRelativePath))
      assert(
        path && !isAbsolute(path) && !path.split(/[\\/]/).includes('..'),
        'LINUX_LAYOUT_UNSUPPORTED',
        'The release executable path is invalid.',
      );
  } else {
    const compose = installation.compose;
    assert(
      compose &&
        /^[a-z0-9][a-z0-9_-]*$/.test(compose.projectName) &&
        isAbsolute(compose.projectDirectory) &&
        compose.files.length > 0 &&
        compose.files.includes(compose.overrideFile),
      'COMPOSE_LAYOUT_UNSUPPORTED',
      'The official Compose installation record is incomplete.',
    );
    for (const path of [...compose.files, ...Object.keys(compose.configFiles)])
      assert(
        isAbsolute(path) && !path.includes('\0'),
        'COMPOSE_LAYOUT_UNSUPPORTED',
        'Compose paths must be absolute host paths.',
      );
    for (const service of Object.values(compose.services))
      assert(
        /^[a-z0-9][a-z0-9_-]*$/.test(service),
        'COMPOSE_LAYOUT_UNSUPPORTED',
        'The recorded Compose service is invalid.',
      );
    assert(
      compose.workerMounts.length > 0 &&
        compose.workerMounts.every(
          (mount) =>
            isAbsolute(mount.source) &&
            mount.source === mount.target &&
            mount.source !== '/' &&
            !mount.source.includes(','),
        ),
      'COMPOSE_PATH_UNRESOLVED',
      'Worker mounts must use verified identical host paths.',
    );
  }
}
export async function loadInstallation(
  path = installationPath(),
): Promise<Installation> {
  const stat = await fs.lstat(path);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o022) === 0 &&
      stat.uid === 0,
    'INSTALLATION_PERMISSIONS',
    'The installation record must be root-owned and protected from writes by application users.',
  );
  const installation = await readJson<Installation>(path);
  validateInstallation(installation);
  assert(
    process.platform === 'linux' && installation.platform.arch === process.arch,
    'PLATFORM_UNSUPPORTED',
    'The installation does not match this Linux host.',
  );
  return installation;
}
