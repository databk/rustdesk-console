// Unpublished qualification only: production Docker, filesystem and health I/O.
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { bootstrap } from '/app/deployment/compose-bootstrap.mjs';
const require = createRequire(import.meta.url);
const runtime = {
  ...require('/app/dist/updater/io.js'),
  ...require('/app/dist/updater/catalog.js'),
  ...require('/app/dist/updater/installation.js'),
  ...require('/app/dist/updater/manifest.js'),
  ...require('/app/dist/updater/adapters/common.js'),
  ...require('/app/dist/updater/adapters/compose.js'),
};
const fixture = JSON.parse(
  await fs.readFile('/test-bootstrap/catalog.json', 'utf8'),
);
if (fixture.testOnly !== 'console-system-update-test')
  throw Error('Test fixture missing');
const validate = runtime.validateInstallation;
runtime.validateInstallation = (installation) => {
  const sourceChecked = structuredClone(installation);
  for (const component of ['backend', 'web']) {
    const artifact = installation.current[component].artifact;
    if (artifact.url !== fixture.current[component].artifact.url)
      throw Error('Unknown local immutable fixture');
    sourceChecked.current[component].artifact.url =
      'ghcr.io/databk/rustdesk-console' +
      (component === 'web' ? '-web' : '') +
      '@sha256:' +
      artifact.sha256;
  }
  validate(sourceChecked);
};
runtime.loadInstallation = async (file) => {
  const stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== 0 ||
    stat.mode & 0o022
  )
    throw Error('Unsafe test installation permissions');
  const installation = await runtime.readJson(file);
  runtime.validateInstallation(installation);
  return installation;
};
runtime.officialFetch = async (url) => {
  const component = ['backend', 'web'].find((key) =>
    url.startsWith(
      'https://api.github.com/repos/' +
        fixture.repositories[key] +
        '/releases/tags/',
    ),
  );
  if (!component) throw Error('Unknown fixture release');
  return Buffer.from(
    JSON.stringify({ id: fixture.current[component].manifest.releaseId }),
  );
};
runtime.OfficialCatalog = class {
  async exact(component, id) {
    const manifest = fixture.current[component].manifest;
    if (manifest.releaseId !== id) throw Error('Unknown fixture release');
    return manifest;
  }
};
try {
  const installation = await bootstrap(runtime, fixture.repositories);
  if (!installation) {
    process.once('SIGTERM', () => process.exit(0));
    setInterval(() => {}, 60000);
  } else {
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
  }
} catch (error) {
  console.error('Test registration failed: ' + (error.code || error.message));
  process.exitCode = 1;
}
