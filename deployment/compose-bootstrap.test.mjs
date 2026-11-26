import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  bootstrap,
  describeRegistrationFailure,
  discoverConfigFiles,
  validateContext,
} from './compose-bootstrap.mjs';

const require = createRequire(import.meta.url);
const io = require('../dist/updater/io.js');
const installationTools = require('../dist/updater/installation.js');
const manifestTools = require('../dist/updater/manifest.js');
const composeTools = require('../dist/updater/adapters/compose.js');

async function fixture(t, databaseEnvironment = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'console-register-'));
  const originalEnvironment = { ...process.env };
  t.after(async () => {
    for (const key of Object.keys(process.env))
      if (!(key in originalEnvironment)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
    await fs.rm(root, { recursive: true, force: true });
  });
  const state = join(root, 'updater-state');
  await fs.mkdir(state, { mode: 0o700 });
  const files = [
    join(root, 'docker-compose.yml'),
    join(root, 'docker-compose.override.yml'),
  ];
  await fs.writeFile(files[0], 'services: {}\n');
  await fs.writeFile(files[1], '# Managed only\nservices: {}\n');
  await fs.writeFile(join(root, '.env'), 'JWT_SECRET=fixture-only\n');
  process.env.SYSTEM_UPDATE_COMPOSE_ROOT = root;
  process.env.SYSTEM_UPDATE_INSTALLATION = join(state, 'installation.json');
  process.env.HOSTNAME = 'c'.repeat(12);
  delete process.env.DOCKER_HOST;
  const names = {
    backend: 'rustdesk-console',
    web: 'rustdesk-console-web',
    updater: 'updater',
  };
  const imageIds = {
    backend: 'sha256:' + 'a'.repeat(64),
    web: 'sha256:' + 'b'.repeat(64),
  };
  const manifests = {};
  for (const component of ['backend', 'web']) {
    const repository =
      'databk/rustdesk-console' + (component === 'web' ? '-web' : '');
    const sha256 = (component === 'backend' ? 'd' : 'e').repeat(64);
    manifests[component] = {
      schemaVersion: 1,
      repository,
      component,
      version: '1.10.0',
      releaseId: component === 'backend' ? 1 : 2,
      tag: '1.10.0',
      sourceCommit: 'a'.repeat(40),
      publishedAt: '2026-09-29T00:00:00Z',
      peerVersionRange: '>=1.0.0 <2.0.0',
      updaterProtocol: 1,
      maintenanceProtocol: 1,
      bundleFormat: 1,
      artifacts: [
        {
          kind: 'oci',
          platform: { os: 'linux', arch: process.arch, libc: 'musl' },
          name: component + '-linux',
          url: 'ghcr.io/' + repository + '@sha256:' + sha256,
          sha256,
          size: 1234,
        },
      ],
    };
  }
  const containers = {};
  const config = { name: 'console-test', services: {} };
  for (const [index, component] of Object.keys(names).entries()) {
    const imageComponent = component === 'web' ? 'web' : 'backend';
    const service = names[component];
    const image = manifests[imageComponent].repository + ':latest';
    const mounts =
      component === 'updater'
        ? [
            { Type: 'bind', Source: root, Destination: root, RW: true },
            { Type: 'bind', Source: root, Destination: '/install', RW: true },
          ]
        : component === 'backend'
          ? [
              {
                Type: 'bind',
                Source: join(root, 'data'),
                Destination: '/data',
                RW: true,
              },
              {
                Type: 'bind',
                Source: join(root, 'updater-ipc'),
                Destination: '/run/rustdesk-console-updater',
                RW: false,
              },
              {
                Type: 'bind',
                Source: join(root, 'updater-maintenance'),
                Destination: '/var/lib/rustdesk-console-maintenance',
                RW: false,
              },
            ]
          : [];
    containers[service] = {
      Id: String(index + 1).repeat(64),
      Image: imageIds[imageComponent],
      State: { Running: true },
      Mounts: mounts,
      NetworkSettings: { Networks: { 'console-test_default': {} } },
      Config: {
        Image: image,
        Env: Object.entries({
          DATA_DIR: '/data',
          PORT: '3000',
          DB_TYPE: 'sqlite',
          ...databaseEnvironment,
        }).map(([key, value]) => `${key}=${value}`),
        Labels: {
          'com.docker.compose.project': 'console-test',
          'com.docker.compose.service': service,
          'com.docker.compose.project.working_dir': root,
          'com.docker.compose.project.config_files': files.join(','),
          'com.docker.compose.config-hash': service + '-hash',
        },
      },
    };
    config.services[service] = {
      image,
      environment: {
        DATA_DIR: '/data',
        PORT: '3000',
        DB_TYPE: 'sqlite',
        ...databaseEnvironment,
      },
    };
  }
  const calls = [];
  const runtime = {
    ...io,
    ...installationTools,
    ...manifestTools,
    ...composeTools,
    OfficialCatalog: class {
      async exact(component) {
        return manifests[component];
      }
    },
    officialFetch: async (url) =>
      Buffer.from(JSON.stringify({ id: url.includes('-web/') ? 2 : 1 })),
    readHealth: async (url) => ({
      component: url.includes('web') ? 'web' : 'backend',
      version: '1.10.0',
      sourceCommit: 'a'.repeat(40),
      ready: true,
      maintenanceProtocol: 1,
    }),
    runCommand: async (_binary, args) => {
      calls.push(args);
      let result;
      if (args[0] === 'info') result = { OSType: 'linux', SecurityOptions: [] };
      else if (args[0] === 'inspect')
        result = [
          args[1] === process.env.HOSTNAME
            ? containers.updater
            : Object.values(containers).find((item) => item.Id === args[1]),
        ];
      else if (args[0] === 'image') {
        const component =
          args[2] === imageIds.web || args[2].includes('-web@')
            ? 'web'
            : 'backend';
        result = [
          {
            Id: imageIds[component],
            RepoDigests: [
              manifests[component].artifacts[0].url,
              manifests[component].repository +
                '@sha256:' +
                manifests[component].artifacts[0].sha256,
            ],
          },
        ];
      } else if (args[0] === 'pull') return { stdout: '', stderr: '' };
      else if (args[0] === 'ps') return { stdout: '', stderr: '' };
      else if (args[0] === 'run') return { stdout: 'f'.repeat(64), stderr: '' };
      else if (args[0] === 'compose') {
        const action = args.slice(9);
        if (action[0] === 'config') {
          result = structuredClone(config);
          const overrideText = await fs.readFile(files[1], 'utf8');
          if (overrideText.trim().startsWith('{')) {
            const override = JSON.parse(overrideText);
            for (const [service, value] of Object.entries(override.services))
              result.services[service].image = value.image;
          }
        } else if (action[0] === 'ps')
          return { stdout: containers[action.at(-1)].Id, stderr: '' };
        else if (action[0] === 'up') {
          const service = action.at(-1);
          containers[service].Config.Image =
            manifests[
              service === names.web ? 'web' : 'backend'
            ].artifacts[0].url;
          return { stdout: '', stderr: '' };
        }
      }
      assert.notEqual(
        result,
        undefined,
        'Unexpected command: ' + args.join(' '),
      );
      return { stdout: JSON.stringify(result), stderr: '' };
    },
  };
  return { root, state, files, containers, manifests, calls, runtime };
}

test('rejects alias paths and unrelated project mounts', () => {
  const self = {
    Config: {
      Labels: {
        'com.docker.compose.service': 'updater',
        'com.docker.compose.project.working_dir': '/real',
      },
    },
    Mounts: [],
  };
  assert.throws(() => validateContext(self, '/install'), /differs/);
  assert.throws(() => validateContext(self, '/real'), /identical/);
  assert.throws(() => validateContext(self, '/'), /absolute/);
});

test('discovers the default Compose files when older Compose records none', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await discoverConfigFiles(f.root), f.files);
});

test('asks for the managed override when Compose started with an explicit file', () => {
  const self = {
    Config: {
      Labels: {
        'com.docker.compose.service': 'updater',
        'com.docker.compose.project': 'console',
        'com.docker.compose.project.working_dir': '/install',
        'com.docker.compose.project.config_files':
          '/install/docker-compose.yml',
      },
    },
    Mounts: [
      { Type: 'bind', Source: '/install', Destination: '/install', RW: true },
    ],
  };
  assert.throws(
    () => validateContext(self, '/install'),
    /managed digest override is not loaded/,
  );
});

test('compares live mounts and commands with the Compose definition', () => {
  const container = {
    Config: {
      Image: 'example:latest',
      Labels: {},
      Env: ['PORT=3000'],
      Cmd: ['old'],
    },
    Mounts: [
      { Type: 'bind', Source: '/host/data', Destination: '/data', RW: true },
    ],
  };
  assert.equal(
    composeTools.verifyServiceInstance(
      {
        image: 'example:latest',
        environment: { PORT: '3000' },
        volumes: [{ type: 'bind', source: '/host/data', target: '/data' }],
        command: ['old'],
      },
      container,
    ),
    null,
  );
  assert.equal(
    composeTools.verifyServiceInstance(
      {
        image: 'example:latest',
        volumes: [{ type: 'bind', source: '/host/data', target: '/data' }],
      },
      { ...container, Mounts: [] },
    ),
    'The running service mounts differ from the Compose configuration.',
  );
  assert.equal(
    composeTools.verifyServiceInstance(
      { image: 'example:latest', command: ['new'] },
      container,
    ),
    'The running service command differs from the Compose configuration.',
  );
});

test('verifies the live service instead of a foreign Compose config hash', async (t) => {
  const f = await fixture(t);
  for (const container of Object.values(f.containers))
    container.Config.Labels['com.docker.compose.config-hash'] = 'f'.repeat(64);
  assert.equal(await bootstrap(f.runtime), null);
});

test('registers services started by an older Compose without a file list', async (t) => {
  const f = await fixture(t);
  for (const container of Object.values(f.containers)) {
    delete container.Config.Labels['com.docker.compose.project.config_files'];
    delete container.Config.Labels['com.docker.compose.project.working_dir'];
  }
  assert.equal(await bootstrap(f.runtime), null);
});

test('resolves a relative Compose file list from an older Compose', async (t) => {
  const f = await fixture(t);
  for (const container of Object.values(f.containers))
    container.Config.Labels['com.docker.compose.project.config_files'] =
      'docker-compose.yml,docker-compose.override.yml';
  assert.equal(await bootstrap(f.runtime), null);
});

test('refuses a running service whose environment drifted from Compose', async (t) => {
  const f = await fixture(t);
  const backend = f.containers['rustdesk-console'];
  backend.Config.Env = backend.Config.Env.map((item) =>
    item === 'PORT=3000' ? 'PORT=3001' : item,
  );
  const error = await bootstrap(f.runtime).then(
    () => assert.fail('registration must be refused'),
    (rejection) => rejection,
  );
  assert.equal(
    describeRegistrationFailure(error),
    'The running service environment differs from the Compose configuration.',
  );
  await assert.rejects(fs.access(join(f.state, 'installation.json')));
  assert.ok(!f.calls.some((args) => args[0] === 'pull' || args.includes('up')));
});

test('refuses a populated user override before any mutation', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    f.files[1],
    'services: {}\nnetworks:\n  default:\n    name: user-network\n',
  );
  await assert.rejects(
    bootstrap(f.runtime),
    /override must start with empty services/,
  );
  assert.equal(
    await fs.readFile(f.files[1], 'utf8'),
    'services: {}\nnetworks:\n  default:\n    name: user-network\n',
  );
  await assert.rejects(fs.access(join(f.state, 'installation.json')));
  assert.ok(!f.calls.some((args) => args[0] === 'pull' || args.includes('up')));
});

test('names the unmet requirement without exposing other failure details', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.files[1], 'services: {}\nnetworks: {}\n');
  const error = await bootstrap(f.runtime).then(
    () => assert.fail('registration must be refused'),
    (rejection) => rejection,
  );
  assert.equal(
    describeRegistrationFailure(error),
    'The managed override must start with empty services.',
  );
  const failed = new Error('docker: DB_PASSWORD=secret');
  failed.code = 'COMMAND_FAILED';
  assert.equal(describeRegistrationFailure(failed), 'COMMAND_FAILED');
  for (const unknown of [
    new SyntaxError('Unexpected token in JSON: DB_PASSWORD=secret'),
    Object.assign(new Error('DB_PASSWORD=secret'), { code: 'lower-case' }),
    undefined,
  ])
    assert.equal(
      describeRegistrationFailure(unknown),
      'verify the standard deployment and official release manifests.',
    );
});

test('logs the unmet requirement when run as the updater command', () => {
  const env = { ...process.env };
  delete env.SYSTEM_UPDATE_COMPOSE_ROOT;
  delete env.SYSTEM_UPDATE_INSTALLATION;
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./compose-bootstrap.mjs', import.meta.url))],
    { encoding: 'utf8', env },
  );
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    'Updater registration unavailable: ' +
      'The standard installation paths are inconsistent.\n',
  );
});

test('pins only exact current images and delegates helper replacement', async (t) => {
  const f = await fixture(t);
  assert.equal(await bootstrap(f.runtime), null);
  const pending = JSON.parse(
    await fs.readFile(join(f.state, 'bootstrap-pending.json'), 'utf8'),
  );
  assert.equal(pending.backend, f.manifests.backend.artifacts[0].url);
  assert.equal(f.calls.filter((args) => args[0] === 'pull').length, 2);
  const detached = f.calls.find((args) => args[0] === 'run');
  assert.ok(detached.includes('--entrypoint'));
  assert.ok(detached.includes('docker'));
  assert.ok(
    !f.calls.some(
      (args) =>
        args[0] === 'compose' &&
        args.includes('up') &&
        args.at(-1) === 'updater',
    ),
  );
  f.containers.updater.Config.Image = pending.backend;
  const installed = await bootstrap(f.runtime);
  assert.equal(installed.installationId, pending.installationId);
  await assert.rejects(fs.access(join(f.state, 'bootstrap-pending.json')));
  const pulls = f.calls.filter((args) => args[0] === 'pull').length;
  await bootstrap(f.runtime);
  assert.equal(f.calls.filter((args) => args[0] === 'pull').length, pulls);
});

test('recovers the same registration after installation record write interruption', async (t) => {
  const f = await fixture(t);
  const atomic = f.runtime.atomicWrite;
  let interrupted = false;
  f.runtime.atomicWrite = async (file, ...args) => {
    if (file.endsWith('/installation.json') && !interrupted) {
      interrupted = true;
      throw new Error('injected power loss');
    }
    return atomic(file, ...args);
  };
  await assert.rejects(bootstrap(f.runtime), /injected power loss/);
  const pending = JSON.parse(
    await fs.readFile(join(f.state, 'bootstrap-pending.json'), 'utf8'),
  );
  await assert.rejects(fs.access(join(f.state, 'installation.json')));
  await bootstrap(f.runtime);
  const record = JSON.parse(
    await fs.readFile(join(f.state, 'installation.json'), 'utf8'),
  );
  assert.equal(record.installationId, pending.installationId);
  assert.equal(record.current.backend.artifact.url, pending.backend);
});

test('registers the effective application MySQL defaults without exposing credentials', async (t) => {
  const f = await fixture(t, {
    DB_TYPE: ' MYSQL ',
    SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA: 'true',
    DB_PASSWORD: 'mysql-secret-sentinel',
  });
  await bootstrap(f.runtime);
  const record = JSON.parse(
    await fs.readFile(join(f.state, 'installation.json'), 'utf8'),
  );
  assert.deepEqual(record.database, {
    kind: 'mysql',
    host: 'localhost',
    port: 3306,
    database: 'rustdesk_console',
    username: 'root',
    passwordFile: join(f.state, 'mysql.password'),
    exclusiveSchema: true,
  });
  assert.equal(
    await fs.readFile(record.database.passwordFile, 'utf8'),
    'mysql-secret-sentinel',
  );
  assert.ok(!JSON.stringify(record).includes('mysql-secret-sentinel'));
});

test('registers the explicit application MySQL account and schema unchanged', async (t) => {
  const f = await fixture(t, {
    DB_TYPE: 'mysql',
    DB_HOST: 'mysql',
    DB_PORT: '3307',
    DB_USERNAME: 'dedicated',
    DB_DATABASE: 'console_custom',
    SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA: 'true',
  });
  await bootstrap(f.runtime);
  const { database } = JSON.parse(
    await fs.readFile(join(f.state, 'installation.json'), 'utf8'),
  );
  assert.equal(database.username, 'dedicated');
  assert.equal(database.database, 'console_custom');
  assert.equal(database.host, 'mysql');
  assert.equal(database.port, 3307);
});
