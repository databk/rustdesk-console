import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

const bundle = path.resolve(process.argv[2] || 'dist-sea');
const metadata = JSON.parse(readFileSync(path.join(bundle, 'build-info.json')));
const executable = path.join(
  bundle,
  process.platform === 'win32' ? 'rustdesk-console.exe' : 'rustdesk-console',
);
const data = mkdtempSync(path.join(tmpdir(), 'console-runtime-'));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  DATA_DIR: data,
  DB_TYPE: 'sqlite',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ADMIN_PASSWORD: randomBytes(24).toString('hex'),
  HOST: '127.0.0.1',
};
let server;
let output = '';
try {
  for (const command of ['self-test', 'migrate']) {
    execFileSync(executable, [command], {
      env,
      cwd: data,
      stdio: 'inherit',
      timeout: 120000,
    });
  }
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  env.PORT = String(probe.address().port);
  await new Promise((resolve) => probe.close(resolve));
  server = spawn(executable, [], {
    cwd: data,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => {
    output = (output + chunk).slice(-16000);
  });
  server.stderr.on('data', (chunk) => {
    output = (output + chunk).slice(-16000);
  });
  let spawnError;
  server.on('error', (error) => {
    spawnError = error;
  });
  let health;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null)
      throw new Error(`Runtime exited: ${server.exitCode}\n${output}`);
    try {
      const response = await fetch(
        `http://127.0.0.1:${env.PORT}/api/system-update/health`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      /* Server is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(health?.ready, true, output);
  assert.equal(health.version, metadata.version);
  assert.equal(health.sourceCommit, metadata.sourceCommit);
  console.log(JSON.stringify(health));
} finally {
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 10000);
    timer.unref();
    await exited;
    clearTimeout(timer);
  }
  rmSync(data, { recursive: true, force: true });
}
