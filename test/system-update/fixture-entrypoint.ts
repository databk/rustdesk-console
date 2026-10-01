/** TEST-ONLY local artifact launcher. Never package this in official releases. */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Catalog } from '../../src/updater/catalog';
import type {
  Component,
  Installation,
  InstalledComponent,
} from '../../src/updater/contracts';
import { ComposeDeployment } from '../../src/updater/adapters/compose';
import { LinuxDeployment } from '../../src/updater/adapters/linux';
import { createBackupAdapter } from '../../src/updater/backups';
import { UpdaterRuntime } from '../../src/updater/entrypoint';
import { assert, UpdateError } from '../../src/updater/errors';
import { readJson } from '../../src/updater/io';
import { Planner } from '../../src/updater/planner';
import { UpdateStore } from '../../src/updater/store';

interface Fixture {
  testOnly: 'console-system-update-test';
  targets: Record<Component, InstalledComponent>;
  archives: Record<string, string>;
}
interface Fault {
  event: string;
  action: 'kill' | 'throw' | 'pause' | 'hold';
}
const fixtureRoot = '/etc/rustdesk-console/test-fixture';

export async function updaterMain(mode: string): Promise<void> {
  assert(
    ['updater', 'worker'].includes(mode),
    'TEST_MODE_INVALID',
    'Unsupported local fixture mode',
  );
  const fixture = await readJson<Fixture>(join(fixtureRoot, 'catalog.json'));
  assert(
    fixture.testOnly === 'console-system-update-test',
    'TEST_FIXTURE_REQUIRED',
    'This local test build requires explicit fixture metadata',
  );
  const path = process.env.SYSTEM_UPDATE_INSTALLATION;
  assert(path, 'TEST_FIXTURE_REQUIRED', 'Missing fixture installation');
  let activeInstallation: Installation;
  function create(installation: Installation, store: UpdateStore): Planner {
    activeInstallation = installation;
    const catalog: Catalog = {
      latest: (component) =>
        Promise.resolve(fixture.targets[component].manifest),
      exact: (component, id) => {
        const candidate = [
          fixture.targets[component],
          installation.current[component],
        ].find((item) => item.manifest.releaseId === id);
        assert(
          candidate,
          'TEST_RELEASE_UNKNOWN',
          'Unknown immutable local fixture release',
        );
        return Promise.resolve(candidate.manifest);
      },
    };
    const deployment =
      installation.deployment === 'managed-compose'
        ? new ComposeDeployment(installation)
        : new LinuxDeployment(installation, undefined, async (url) => {
            const archive = fixture.archives[url];
            assert(
              archive?.startsWith(`${fixtureRoot}/`),
              'TEST_ARTIFACT_UNKNOWN',
              'Unknown immutable local fixture archive',
            );
            return fs.readFile(archive);
          });
    return new Planner(
      installation,
      deployment,
      createBackupAdapter(installation.database),
      catalog,
      store,
    );
  }
  await new UpdaterRuntime({
    loadInstallation: () => readJson<Installation>(path),
    createPlanner: create,
    observe: async (event, record) => {
      const initial = activeInstallation;
      const jobId = record.view.jobId;
      const configured = await readJson<Fault | Fault[]>(
        join(fixtureRoot, 'fault.json'),
      ).catch(() => [] as Fault[]);
      const fault = (
        Array.isArray(configured) ? configured : [configured]
      ).find((item) => item.event === event);
      if (!fault) return;
      const marker = join(
        initial.stateDir,
        `test-fault-${jobId}-${event.replace(/:/g, '-')}`,
      );
      try {
        const file = await fs.open(marker, 'wx', 0o600);
        await file.close();
      } catch {
        return;
      }
      if (fault.action === 'hold') {
        // Pause only; an external test changes a real resource, then resumes I/O.
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline) {
          try {
            await fs.access(`${marker}-continue`);
            return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        throw new Error('External fixture resource change did not complete');
      } else if (fault.action === 'pause') {
        // The external runner accepts a real business write before killing us.
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Fixture pause expired before the external assertion');
      } else if (fault.action === 'kill') {
        // Both supervisors are terminated externally after recording this marker.
        // Self-termination cannot establish the acceptance boundary.
        await new Promise(() => {});
      } else
        throw new UpdateError(
          'TEST_INJECTED_FAILURE',
          'Injected local fixture failure',
        );
    },
  }).run(mode);
}
