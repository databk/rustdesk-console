/** 仅供 colocated tests 引用；生产入口不导入此文件。 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import {
  BackupAdapter,
  BackupContext,
  BackupSnapshot,
  Component,
  DeploymentAdapter,
  Installation,
  InstalledComponent,
  JobRecord,
  PersistedPlan,
  ReleaseManifest,
} from './contracts';
import { Catalog } from './catalog';
import { Planner } from './planner';
import { UpdateStore } from './store';
import { UpdateControl } from './control';
export function testArchive(
  entries: { path: string; content?: string; type?: string }[],
): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? 'test');
    const header = Buffer.alloc(512);
    header.write(entry.path);
    header.write('0000755', 100);
    header.write(content.length.toString(8).padStart(11, '0'), 124);
    header.write(entry.type ?? '0', 156);
    header.fill(32, 148, 156);
    const sum = header.reduce((total, value) => total + value, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
    content.copy(padded);
    blocks.push(header, padded);
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
export function testRelease(
  component: Component,
  version: string,
): InstalledComponent {
  const repository = `databk/rustdesk-console${component === 'web' ? '-web' : ''}`;
  const sourceCommit = 'a'.repeat(40);
  const sha256 = 'b'.repeat(64);
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    repository,
    component,
    version,
    releaseId: version === '1.0.0' ? 1 : 2,
    tag: `v${version}`,
    sourceCommit,
    publishedAt: '2026-09-29T00:00:00Z',
    peerVersionRange: '>=1.0.0 <2.0.0',
    updaterProtocol: 1,
    maintenanceProtocol: 1,
    bundleFormat: 1,
    artifacts: [
      {
        kind: 'oci',
        platform: { os: 'linux', arch: 'x64', libc: 'musl' },
        name: `${component}-linux-x64`,
        url: `ghcr.io/${repository}@sha256:${sha256}`,
        sha256,
        size: 1,
      },
    ],
  };
  return { version, sourceCommit, artifact: manifest.artifacts[0], manifest };
}
export async function testHarness() {
  const root = await fs.mkdtemp(join(tmpdir(), 'console-updater-test-'));
  const installation: Installation = {
    schemaVersion: 1,
    installationId: randomUUID(),
    deployment: 'managed-compose',
    platform: { os: 'linux', arch: 'x64', libc: 'musl' },
    stateDir: join(root, 'state'),
    ipcDir: join(root, 'ipc'),
    maintenanceFile: join(root, 'maintenance.json'),
    dataDir: join(root, 'data'),
    backendHealthUrl: 'http://backend:3000/api/system-update/health',
    webHealthUrl: 'http://web/system-update-health.json',
    current: {
      backend: testRelease('backend', '1.0.0'),
      web: testRelease('web', '1.0.0'),
    },
    database: { kind: 'sqlite', path: join(root, 'data', 'console.db') },
  };
  const events: string[] = [];
  const deployment: jest.Mocked<DeploymentAdapter> = {
    preflight: jest.fn(() => Promise.resolve([])),
    fingerprint: jest.fn(() => Promise.resolve('fingerprint')),
    prepare: jest.fn((_plan: PersistedPlan) => {
      return Promise.resolve().then(() => {
        events.push('prepare');
      });
    }),
    stopApplications: jest.fn(() => {
      return Promise.resolve().then(() => {
        events.push('stop');
      });
    }),
    switchApplications: jest.fn((_plan: PersistedPlan) => {
      return Promise.resolve().then(() => {
        events.push('switch');
      });
    }),
    startApplications: jest.fn(() => {
      return Promise.resolve().then(() => {
        events.push('start');
      });
    }),
    verify: jest.fn((_plan, restored) => {
      return Promise.resolve().then(() => {
        events.push(restored ? 'verify-old' : 'verify-new');
      });
    }),
    updateHelper: jest.fn((_plan: PersistedPlan) => {
      return Promise.resolve().then(() => {
        events.push('helper');
      });
    }),
    restoreDeployment: jest.fn((_record: JobRecord) => {
      return Promise.resolve().then(() => {
        events.push('restore-deployment');
      });
    }),
    commit: jest.fn((_plan: PersistedPlan) => {
      return Promise.resolve().then(() => {
        events.push('commit');
      });
    }),
    startWorker: jest.fn((_jobId: string) => {
      return Promise.resolve().then(() => {});
    }),
    workerAlive: jest.fn((_jobId: string) => Promise.resolve(false)),
  };
  const backup: jest.Mocked<BackupAdapter> = {
    preflight: jest.fn((_context: BackupContext) => Promise.resolve([])),
    backup: jest.fn((context) => {
      return Promise.resolve().then(() => {
        events.push('backup');
        return {
          schemaVersion: 1 as const,
          jobId: context.jobId,
          database: 'sqlite' as const,
          path: context.backupDir,
          createdAt: new Date().toISOString(),
          metadata: {},
        };
      });
    }),
    validate: jest.fn((_context: BackupContext, _snapshot: BackupSnapshot) => {
      return Promise.resolve().then(() => {
        events.push('validate-backup');
      });
    }),
    restore: jest.fn((_context: BackupContext, _snapshot: BackupSnapshot) => {
      return Promise.resolve().then(() => {
        events.push('restore-data');
      });
    }),
  };
  const catalog: jest.Mocked<Catalog> = {
    latest: jest.fn((component) =>
      Promise.resolve(testRelease(component, '1.1.0').manifest),
    ),
    exact: jest.fn((component, id) =>
      Promise.resolve(
        testRelease(component, id === 1 ? '1.0.0' : '1.1.0').manifest,
      ),
    ),
  };
  const store = new UpdateStore(installation.stateDir);
  await store.initialize();
  const planner = new Planner(installation, deployment, backup, catalog, store);
  const control = new UpdateControl(planner);
  const accept = async () => {
    const plan = await planner.create();
    return control.accept(
      {
        planId: plan.planId,
        idempotencyKey: randomUUID(),
        acknowledgeDowntime: true,
      },
      'admin',
    );
  };
  return {
    root,
    installation,
    events,
    deployment,
    backup,
    catalog,
    store,
    planner,
    control,
    accept,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}
