import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entrypoint = join(
  dirname(fileURLToPath(import.meta.url)),
  'docker-entrypoint.sh',
);
const requiresRootLinux =
  process.platform !== 'linux' || process.getuid() !== 0;

function run(command, args, env) {
  const result = spawnSync(command, args, { encoding: 'utf8', env });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'console-entrypoint-'));
  await fs.chmod(root, 0o755);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  const state = join(root, 'state');
  await fs.mkdir(data, { mode: 0o755 });
  await fs.mkdir(state, { mode: 0o700 });
  await fs.chmod(state, 0o700);
  const env = { ...process.env, DATA_DIR: data, TEST_STATE: state };
  for (const key of Object.keys(env))
    if (key.startsWith('SYSTEM_UPDATE_')) delete env[key];
  return { root, data, state, env };
}

test(
  'managed backend uses UID 1000 without updater-state access',
  { skip: requiresRootLinux },
  async (t) => {
    const { root, data, state, env } = await fixture(t);
    const output = run(
      'sh',
      [
        entrypoint,
        'sh',
        '-ec',
        `
    id -u
    id -g
    sqlite3 "$DATA_DIR/rustdesk-console.db" "CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('managed');"
    printf 'managed\n' > "$DATA_DIR/business.txt"
    test ! -r "$TEST_STATE"
    test ! -w "$TEST_STATE"
    if touch "$TEST_STATE/forbidden" 2>/dev/null; then exit 1; fi
  `,
      ],
      {
        ...env,
        SYSTEM_UPDATE_SOCKET: join(root, 'ipc/control.sock'),
        SYSTEM_UPDATE_MAINTENANCE_FILE: join(
          root,
          'maintenance/maintenance.json',
        ),
      },
    );
    assert.equal(output, '1000\n1000');
    const stat = await fs.stat(data);
    assert.equal(stat.uid, 1000);
    assert.equal(stat.gid, 1000);
    assert.equal((await fs.stat(state)).uid, 0);
    assert.deepEqual(await fs.readdir(state), []);
  },
);

test(
  'explicit non-root invocation retains its configured identity',
  { skip: requiresRootLinux },
  async (t) => {
    const { env } = await fixture(t);
    const output = run(
      'su-exec',
      ['1234:1234', 'sh', entrypoint, 'id', '-u'],
      env,
    );
    assert.equal(output, '1234');
  },
);

test(
  'opt-in local management uses the mounted socket group without root or updater-state access',
  { skip: requiresRootLinux },
  async (t) => {
    const { root, env } = await fixture(t);
    const socket = join(root, 'docker.sock');
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    await fs.chown(socket, 0, 1234);
    await fs.chmod(socket, 0o660);
    const output = run(
      'sh',
      [
        entrypoint,
        'sh',
        '-ec',
        'id -u; id -g; test -w "$DOCKER_SOCKET"; test ! -r "$TEST_STATE"; test ! -w "$TEST_STATE"',
      ],
      {
        ...env,
        SERVER_MANAGEMENT_LOCAL: '1',
        DOCKER_SOCKET: socket,
      },
    );
    assert.equal(output, '1000\n1234');
  },
);

test(
  'opt-in local management fails before startup without a mounted socket',
  { skip: requiresRootLinux },
  async (t) => {
    const { root, env } = await fixture(t);
    const result = spawnSync('sh', [entrypoint, 'id', '-u'], {
      encoding: 'utf8',
      env: {
        ...env,
        SERVER_MANAGEMENT_LOCAL: '1',
        DOCKER_SOCKET: join(root, 'missing.sock'),
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a mounted Docker socket/);
  },
);

test(
  'updater keeps root and protects its state directory',
  { skip: requiresRootLinux },
  async (t) => {
    const { root, state, env } = await fixture(t);
    const output = run('sh', [entrypoint, 'id', '-u'], {
      ...env,
      SYSTEM_UPDATE_ROLE: 'updater',
      SYSTEM_UPDATE_INSTALLATION: join(state, 'installation.json'),
      SYSTEM_UPDATE_SOCKET: join(root, 'ipc/control.sock'),
      SYSTEM_UPDATE_MAINTENANCE_FILE: join(
        root,
        'maintenance/maintenance.json',
      ),
    });
    assert.equal(output, '0');
    assert.equal((await fs.stat(state)).mode & 0o777, 0o700);
  },
);

for (const mode of ['updater', 'worker', 'recover']) {
  test(
    `${mode} command branch retains root even with managed paths`,
    { skip: requiresRootLinux },
    async (t) => {
      const { root, env } = await fixture(t);
      const output = run(
        'sh',
        [entrypoint, 'sh', '-c', 'id -u', `--system-update-mode=${mode}`],
        {
          ...env,
          SYSTEM_UPDATE_SOCKET: join(root, 'ipc/control.sock'),
          SYSTEM_UPDATE_MAINTENANCE_FILE: join(
            root,
            'maintenance/maintenance.json',
          ),
        },
      );
      assert.equal(output, '0');
    },
  );
}
