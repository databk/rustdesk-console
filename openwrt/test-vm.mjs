// Run only in the disposable ARM64 VM created by test-qemu.py.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

assert.equal(process.env.OPENWRT_PACKAGE_TEST, '1');
assert.equal(process.arch, 'arm64');
const phase = process.argv[2];
assert.ok(['initial', 'restart', 'reboot'].includes(phase));
const credentialFile = '/etc/rustdesk-console/credentials';
const rawCredentials = readFileSync(credentialFile, 'utf8');
const credentials = Object.fromEntries(
  rawCredentials
    .trim()
    .split('\n')
    .map((line) => line.split('=')),
);
assert.equal(statSync(credentialFile).mode & 0o777, 0o600);
execFileSync(
  '/usr/lib/rustdesk-console/backend/rustdesk-console',
  ['self-test'],
  {
    stdio: 'inherit',
    timeout: 60000,
  },
);
let health;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    const response = await fetch(
      'http://127.0.0.1:21114/api/system-update/health',
      {
        signal: AbortSignal.timeout(3000),
      },
    );
    if (response.ok) {
      health = await response.json();
      break;
    }
  } catch {
    /* Wait for procd and the application to become ready. */
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(health?.ready, true);
assert.match(
  await (
    await fetch('http://127.0.0.1:21114/', {
      signal: AbortSignal.timeout(10000),
    })
  ).text(),
  /<html/i,
);
const response = await fetch('http://127.0.0.1:21114/api/login', {
  signal: AbortSignal.timeout(15000),
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'databk',
    password: credentials.ADMIN_PASSWORD,
  }),
});
assert.equal(response.status, 200);
const session = await response.json();
assert.ok(session.access_token);
assert.ok(session.user.guid);
const state = {
  owner: session.user.guid,
  credentials: createHash('sha256').update(rawCredentials).digest('hex'),
  boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
};
if (phase === 'initial') {
  writeFileSync('/root/console-test-state.json', JSON.stringify(state), {
    mode: 0o600,
  });
} else {
  const initial = JSON.parse(
    readFileSync('/root/console-test-state.json', 'utf8'),
  );
  assert.equal(state.owner, initial.owner);
  assert.equal(state.credentials, initial.credentials);
  if (phase === 'restart') assert.equal(state.boot, initial.boot);
  else assert.notEqual(state.boot, initial.boot);
  assert.ok(
    existsSync('/srv/rustdesk-console/pre-migration/rustdesk-console.db'),
  );
}
const result = JSON.parse(
  execFileSync('ubus', [
    'call',
    'service',
    'list',
    JSON.stringify({ name: 'rustdesk-console' }),
  ]),
);
for (const name of ['backend', 'web']) {
  const instance = result['rustdesk-console'].instances[name];
  assert.equal(instance.running, true);
  const status = readFileSync(`/proc/${instance.pid}/status`, 'utf8');
  const expectedUid = Number(
    readFileSync('/etc/passwd', 'utf8')
      .split('\n')
      .find((line) => line.startsWith('rustdesk-console:'))
      .split(':')[2],
  );
  assert.notEqual(expectedUid, 0);
  assert.equal(Number(status.match(/^Uid:\s+(\d+)/m)[1]), expectedUid);
  console.log(
    JSON.stringify({
      instance: name,
      pid: instance.pid,
      rss: status.match(/^VmRSS:\s+(.+)/m)[1],
    }),
  );
}
console.log(
  JSON.stringify({
    phase,
    architecture: process.arch,
    sqlite3: 'ok',
    sharp: 'ok',
    procd: 'ok',
    login: 'ok',
    persistence: 'ok',
  }),
);
