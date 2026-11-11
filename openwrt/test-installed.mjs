// Run only inside the disposable package-test rootfs, after test-package.sh.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';

assert.equal(process.env.OPENWRT_PACKAGE_TEST, '1');
const readEnv = (file) =>
  Object.fromEntries(
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
const backendEnv = readEnv('/tmp/console-backend.env');
const webEnv = readEnv('/tmp/console-web.env');
assert.equal(backendEnv.HOST, '127.0.0.1');
assert.equal(backendEnv.PORT, '21115');
assert.equal(backendEnv.DATA_DIR, '/srv/rustdesk-console');
assert.equal(backendEnv.DB_TYPE, 'sqlite');
assert.equal(backendEnv.JWT_SECRET.length, 64);
assert.equal(backendEnv.ADMIN_PASSWORD.length, 48);
assert.equal(backendEnv.NODE_OPTIONS, '--max-old-space-size=128');
assert.equal(webEnv.BACKEND_URL, 'http://127.0.0.1:21115');
const user = readFileSync('/etc/passwd', 'utf8')
  .split('\n')
  .find((line) => line.startsWith('rustdesk-console:'))
  .split(':');
const options = {
  uid: Number(user[2]),
  gid: Number(user[3]),
  cwd: backendEnv.DATA_DIR,
};
assert.notEqual(options.uid, 0);
assert.equal(statSync('/etc/rustdesk-console/credentials').mode & 0o777, 0o600);
assert.equal(statSync(backendEnv.DATA_DIR).uid, options.uid);
assert.equal(
  statSync('/usr/lib/rustdesk-console/backend/node').mode & 0o022,
  0,
);
assert.equal(
  statSync('/usr/lib/rustdesk-console/backend/console.cjs').mode & 0o022,
  0,
);
for (const file of [
  '/usr/share/luci/menu.d/luci-app-rustdesk-console.json',
  '/usr/share/rpcd/acl.d/luci-app-rustdesk-console.json',
]) {
  assert.equal(statSync(file).mode & 0o777, 0o644);
}
execFileSync(
  '/usr/lib/rustdesk-console/backend/rustdesk-console',
  ['self-test'],
  { ...options, env: { ...process.env, ...backendEnv }, stdio: 'inherit' },
);

let owner;
for (let cycle = 0; cycle < 2; cycle++) {
  let output = '';
  const backend = spawn('/usr/libexec/rustdesk-console-run', [], {
    ...options,
    env: { ...process.env, ...backendEnv },
  });
  const web = spawn('/usr/lib/rustdesk-console/web/rustdesk-console-web', [], {
    ...options,
    env: { ...process.env, ...webEnv },
  });
  for (const child of [backend, web]) {
    child.on('error', (error) => {
      output = (output + error.message).slice(-16000);
    });
    child.stdout.on('data', (data) => {
      output = (output + data).slice(-16000);
    });
    child.stderr.on('data', (data) => {
      output = (output + data).slice(-16000);
    });
  }
  try {
    let health;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (backend.exitCode !== null || web.exitCode !== null)
        throw new Error(output);
      try {
        const response = await fetch(
          'http://127.0.0.1:21114/api/system-update/health',
          { signal: AbortSignal.timeout(1000) },
        );
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {
        /* Wait for startup. */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(health?.ready, true, output);
    assert.match(
      await (
        await fetch('http://127.0.0.1:21114/', {
          signal: AbortSignal.timeout(10000),
        })
      ).text(),
      /<html/i,
    );
    const login = await fetch('http://127.0.0.1:21114/api/login', {
      signal: AbortSignal.timeout(15000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'databk',
        password: backendEnv.ADMIN_PASSWORD,
      }),
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.ok(session.access_token);
    assert.ok(session.user?.guid);
    if (cycle === 0) owner = session.user.guid;
    else assert.equal(session.user.guid, owner);
    console.log(
      `Installed package cycle ${cycle + 1}: non-root API, web proxy, HTML and login OK`,
    );
  } finally {
    await Promise.all(
      [backend, web].map(async (child) => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null)
          return;
        const exit = once(child, 'exit');
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        timer.unref();
        await exit;
        clearTimeout(timer);
      }),
    );
  }
}
assert.ok(
  statSync('/srv/rustdesk-console/pre-migration/rustdesk-console.db').size > 0,
);
