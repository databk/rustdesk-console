import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
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

for (const partialEnvironment of [
  {},
  { SYSTEM_UPDATE_SOCKET: '/unused/control.sock' },
  { SYSTEM_UPDATE_MAINTENANCE_FILE: '/unused/maintenance.json' },
]) {
  const name = Object.keys(partialEnvironment)[0] || 'no managed paths';
  test(
    `legacy root-owned SQLite and business files remain writable: ${name}`,
    { skip: requiresRootLinux },
    async (t) => {
      const { data, env } = await fixture(t);
      const database = join(data, 'rustdesk-console.db');
      const businessFile = join(data, 'business.txt');
      run(
        'sqlite3',
        [
          database,
          "CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('before');",
        ],
        env,
      );
      await fs.writeFile(businessFile, 'before\n', { mode: 0o644 });
      await fs.chmod(database, 0o644);
      await fs.chmod(businessFile, 0o644);
      const before = await Promise.all(
        [data, database, businessFile].map((path) => fs.stat(path)),
      );
      assert.ok(before.every((value) => value.uid === 0 && value.gid === 0));
      const output = run(
        'sh',
        [
          entrypoint,
          'sh',
          '-ec',
          `
      id -u
      sqlite3 "$DATA_DIR/rustdesk-console.db" "INSERT INTO sentinel VALUES ('after');"
      printf 'after\n' >> "$DATA_DIR/business.txt"
    `,
        ],
        { ...env, ...partialEnvironment },
      );
      assert.equal(output, '0');
      assert.equal(
        run(
          'sqlite3',
          [database, 'SELECT value FROM sentinel ORDER BY rowid;'],
          env,
        ),
        'before\nafter',
      );
      assert.equal(await fs.readFile(businessFile, 'utf8'), 'before\nafter\n');
      const after = await Promise.all(
        [data, database, businessFile].map((path) => fs.stat(path)),
      );
      assert.deepEqual(
        after.map(({ uid, gid, mode }) => ({ uid, gid, mode })),
        before.map(({ uid, gid, mode }) => ({ uid, gid, mode })),
      );
    },
  );
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
