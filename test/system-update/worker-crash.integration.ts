import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Catalog } from '../../src/updater/catalog';
import type {
  Component,
  DeploymentAdapter,
  Installation,
  InstalledComponent,
  JobRecord,
} from '../../src/updater/contracts';
import { UpdateControl } from '../../src/updater/control';
import {
  acquireProcessLock,
  atomicWrite,
  readJson,
} from '../../src/updater/io';
import { readMaintenance } from '../../src/updater/maintenance';
import { Planner } from '../../src/updater/planner';
import { UpdateStore } from '../../src/updater/store';
import { UpdateWorker } from '../../src/updater/worker';
import { SqliteBackupAdapter } from '../../src/updater/backups/sqlite';

const exec = promisify(execFile);
const sql = async (
  installation: Installation,
  statement: string,
): Promise<string> =>
  (
    await exec('sqlite3', [
      join(installation.dataDir, 'console.sqlite'),
      statement,
    ])
  ).stdout.trim();

function component(name: Component, version: string): InstalledComponent {
  const artifact = {
    kind: 'archive' as const,
    platform: {
      os: 'linux' as const,
      arch: 'x64' as const,
      libc: 'musl' as const,
    },
    name: `${name}.tar.gz`,
    url: `https://github.com/databk/rustdesk-console${name === 'web' ? '-web' : ''}/releases/download/v${version}/${name}.tar.gz`,
    sha256: 'a'.repeat(64),
    size: 1,
  };
  return {
    version,
    sourceCommit: 'b'.repeat(40),
    artifact,
    manifest: {
      schemaVersion: 1,
      repository:
        name === 'backend'
          ? 'databk/rustdesk-console'
          : 'databk/rustdesk-console-web',
      component: name,
      version,
      releaseId: Number(version.split('.')[1]) + (name === 'web' ? 100 : 1),
      tag: `v${version}`,
      sourceCommit: 'b'.repeat(40),
      publishedAt: '2026-09-29T00:00:00.000Z',
      peerVersionRange: '>=1.0.0 <2.0.0',
      updaterProtocol: 1,
      maintenanceProtocol: 1,
      bundleFormat: 1,
      artifacts: [artifact],
    },
  };
}

// This fixture replaces deployment only. Never count this suite as four-matrix acceptance.
function fixtureDeployment(
  installation: Installation,
  failVerification: boolean,
): DeploymentAdapter {
  const deployed = join(installation.stateDir, 'fixture-deployment.json');
  return {
    preflight: () => Promise.resolve([]),
    fingerprint: () => Promise.resolve('fixture-deployment-fingerprint'),
    prepare: () => Promise.resolve(),
    stopApplications: () => Promise.resolve(),
    switchApplications: async () => {
      await atomicWrite(deployed, { version: '1.1.0' });
      await sql(
        installation,
        "INSERT INTO evidence VALUES(2,'upgrade-write');",
      );
    },
    startApplications: () => Promise.resolve(),
    verify: async (_plan, restored) => {
      if (failVerification && !restored)
        throw new Error('Injected target startup failure');
      const actual = await readJson<{ version: string }>(deployed);
      assert.equal(actual.version, restored ? '1.0.0' : '1.1.0');
    },
    updateHelper: () => Promise.resolve(),
    restoreDeployment: () => atomicWrite(deployed, { version: '1.0.0' }),
    commit: (plan) =>
      atomicWrite(join(installation.stateDir, 'installation.json'), {
        ...installation,
        current: plan.targets,
      }),
    startWorker: () => Promise.resolve(),
    workerAlive: () => Promise.resolve(false),
  };
}

function planner(
  installation: Installation,
  failVerification = false,
): Planner {
  const targets = {
    backend: component('backend', '1.1.0'),
    web: component('web', '1.0.0'),
  };
  const catalog: Catalog = {
    latest: (name) => Promise.resolve(targets[name].manifest),
    exact: (name) => Promise.resolve(targets[name].manifest),
  };
  return new Planner(
    installation,
    fixtureDeployment(installation, failVerification),
    new SqliteBackupAdapter(),
    catalog,
    new UpdateStore(installation.stateDir),
  );
}

async function executeChild(
  root: string,
  jobId: string,
  event: string,
  fail: boolean,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [__filename, 'child', root, jobId, event, String(fail)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let error = '';
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0 || signal === 'SIGKILL') resolve(signal);
      else reject(new Error(`Worker child exit ${code}: ${error}`));
    });
  });
}

async function scenario(
  event: string,
  fail = false,
): Promise<Record<string, unknown>> {
  const root = await fs.mkdtemp('/tmp/console-system-update-test-worker-');
  const dataDir = join(root, 'data');
  await fs.mkdir(dataDir, { mode: 0o700 });
  const installation: Installation = {
    schemaVersion: 1,
    installationId: randomUUID(),
    deployment: 'managed-linux',
    platform: { os: 'linux', arch: 'x64', libc: 'musl' },
    stateDir: join(root, 'state'),
    ipcDir: join(root, 'ipc'),
    maintenanceFile: join(root, 'maintenance', 'marker.json'),
    dataDir,
    backendHealthUrl: 'http://127.0.0.1:3000/api/system-update/health',
    webHealthUrl: 'http://127.0.0.1/system-update-health.json',
    current: {
      backend: component('backend', '1.0.0'),
      web: component('web', '1.0.0'),
    },
    database: { kind: 'sqlite', path: join(dataDir, 'console.sqlite') },
  };
  const p = planner(installation);
  await p.store.initialize();
  await atomicWrite(join(installation.stateDir, 'fixture-deployment.json'), {
    version: '1.0.0',
  });
  await atomicWrite(
    join(installation.stateDir, 'installation.json'),
    installation,
  );
  await sql(
    installation,
    "CREATE TABLE evidence(id INT PRIMARY KEY, value TEXT); INSERT INTO evidence VALUES(1,'baseline');",
  );
  const plan = await p.create();
  assert.equal(plan.executable, true);
  const control = new UpdateControl(p);
  const request = {
    planId: plan.planId,
    idempotencyKey: randomUUID(),
    acknowledgeDowntime: true as const,
  };
  const accepted = await control.accept(request, 'integration-admin');
  assert.equal(
    (await control.accept(request, 'integration-admin')).jobId,
    accepted.jobId,
  );
  await assert.rejects(
    control.accept(
      { ...request, idempotencyKey: randomUUID() },
      'another-admin',
    ),
  );
  assert.equal(
    await executeChild(root, accepted.jobId, event, fail),
    event ? 'SIGKILL' : null,
  );
  const interrupted = await p.store.job(accepted.jobId);
  if (event.startsWith('after:')) {
    assert(interrupted.decision);
    // Recreate the crash window after reopening but before final status persistence.
    await atomicWrite(installation.maintenanceFile, {
      schemaVersion: 1,
      jobId: accepted.jobId,
      active: false,
      allowStart: true,
    });
    await sql(
      installation,
      "INSERT INTO evidence VALUES(3,'accepted-after-decision');",
    );
  }
  if (event) await executeChild(root, accepted.jobId, '', false);
  const finished = await p.store.job(accepted.jobId);
  assert.equal(finished.view.jobId, accepted.jobId);
  const restored = event !== 'after:commit_decided' && (event !== '' || fail);
  const preSwitch = ['prepare:done', 'backup:done'].includes(event);
  const uncertain = event === 'restore_data:intent';
  assert.equal(
    finished.view.status,
    uncertain
      ? 'recovery_required'
      : preSwitch
        ? 'failed'
        : restored
          ? 'rolled_back'
          : 'succeeded',
  );
  assert.equal(
    readMaintenance(installation.maintenanceFile)?.active,
    uncertain,
  );
  if (event.startsWith('after:'))
    assert.equal(
      await sql(installation, 'SELECT value FROM evidence WHERE id=3;'),
      'accepted-after-decision',
    );
  if (restored && !uncertain)
    assert.equal(
      await sql(installation, 'SELECT COUNT(*) FROM evidence WHERE id=2;'),
      '0',
    );
  return {
    event: event || 'none',
    status: finished.view.status,
    decision: finished.decision ?? null,
    sameJob: true,
    root,
  };
}

async function main(): Promise<void> {
  if (process.argv[2] === 'child') {
    const [, , , root, jobId, event, fail] = process.argv;
    const store = new UpdateStore(join(root, 'state'));
    const record: JobRecord = await store.job(jobId);
    const release = await acquireProcessLock(join(root, 'execution.lock'));
    try {
      await new UpdateWorker(
        planner(record.originalInstallation, fail === 'true'),
        async (boundary) => {
          if (event && boundary === event) {
            await fs.writeFile(
              join(root, 'interruption.json'),
              JSON.stringify({ boundary, jobId }),
            );
            process.kill(process.pid, 'SIGKILL');
          }
        },
      ).run(jobId);
    } finally {
      await release();
    }
    return;
  }
  const results: Record<string, unknown>[] = [];
  for (const event of [
    '',
    'prepare:done',
    'backup:done',
    'switch:done',
    'helper:done',
    'persist_installation:done',
    'before:commit_decided',
    'after:commit_decided',
  ])
    results.push(await scenario(event));
  for (const event of [
    'before:restore_decided',
    'after:restore_decided',
    'restore_data:intent',
  ])
    results.push(await scenario(event, true));
  console.log(
    JSON.stringify({
      suite: 'durable-worker-process-interruptions',
      results,
      scope:
        'real processes, flock, journal and SQLite adapter; filesystem deployment fixture; NOT deployment matrix acceptance',
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Integration failed');
  process.exitCode = 1;
});
