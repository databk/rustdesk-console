import { promises as fs } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { Installation, InstalledComponent, PersistedPlan } from '../contracts';
import { assert, UpdateError } from '../errors';
import { atomicWrite, digest } from '../io';
import { installationPath } from '../installation';
export interface Health {
  component: string;
  version: string;
  sourceCommit: string;
  ready: boolean;
  maintenanceProtocol: number;
}
export type HealthReader = (url: string) => Promise<Health>;
export const readHealth: HealthReader = async (url) => {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  assert(
    response.ok,
    'HEALTH_CHECK_FAILED',
    'The updated service is not ready.',
  );
  const text = await response.text();
  assert(
    text.length < 8192,
    'HEALTH_CHECK_FAILED',
    'The health response is invalid.',
  );
  return JSON.parse(text) as Health;
};
export async function verifyHealth(
  installation: Installation,
  targets: Record<'backend' | 'web', InstalledComponent>,
  reader: HealthReader,
): Promise<void> {
  let failure: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      for (const [component, url] of [
        ['backend', installation.backendHealthUrl],
        ['web', installation.webHealthUrl],
        [
          'backend',
          new URL('/api/system-update/health', installation.webHealthUrl).href,
        ],
      ] as const) {
        const result = await reader(url);
        const expected = targets[component];
        assert(
          result.component === component &&
            result.version === expected.version &&
            result.sourceCommit === expected.sourceCommit &&
            result.ready === true &&
            result.maintenanceProtocol === 1,
          'HEALTH_VERSION_MISMATCH',
          'The running application or frontend proxy does not match the verified release.',
        );
      }
      const page = await fetch(new URL('/', installation.webHealthUrl), {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
      assert(
        page.ok &&
          (page.headers.get('content-type') ?? '').includes('text/html'),
        'FRONTEND_UNAVAILABLE',
        'The frontend page is not ready.',
      );
      const html = await page.text();
      assert(
        html.length < 4 * 1024 * 1024,
        'FRONTEND_UNAVAILABLE',
        'The frontend page is invalid.',
      );
      const assets = [
        ...html.matchAll(
          /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g,
        ),
      ].map((match) => match[1]);
      assert(
        assets.length > 0,
        'FRONTEND_UNAVAILABLE',
        'The frontend page has no verifiable static assets.',
      );
      for (const asset of assets.slice(0, 20)) {
        const url = new URL(asset, installation.webHealthUrl);
        assert(
          url.origin === new URL(installation.webHealthUrl).origin,
          'FRONTEND_UNAVAILABLE',
          'Frontend assets are not served by the managed installation.',
        );
        const resource = await fetch(url, {
          method: 'HEAD',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        assert(
          resource.ok,
          'FRONTEND_UNAVAILABLE',
          'A frontend static resource is unavailable.',
        );
      }
      return;
    } catch (error: unknown) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw failure instanceof UpdateError
    ? failure
    : new UpdateError(
        'HEALTH_CHECK_FAILED',
        'The applications did not become ready within the verification window.',
      );
}
export async function verifyHelper(
  installation: Installation,
  expected = installation.current.backend,
): Promise<void> {
  const socketPath =
    process.env.SYSTEM_UPDATE_SOCKET ??
    join(installation.ipcDir, 'control.sock');
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = request(
          { socketPath, method: 'POST', path: '/', timeout: 3000 },
          (response) => {
            let data = '';
            response.on('data', (chunk: Buffer) => {
              data += chunk.toString();
              if (data.length > 8192) req.destroy();
            });
            response.on('end', () => {
              try {
                const value = JSON.parse(data) as {
                  protocolVersion: number;
                  installationId: string;
                  activeJobId: string | null;
                  version: string;
                  sourceCommit: string;
                  ready: boolean;
                };
                assert(
                  response.statusCode === 200 &&
                    value.protocolVersion === 1 &&
                    value.installationId === installation.installationId &&
                    Boolean(value.activeJobId) &&
                    value.ready === true &&
                    value.version === expected.version &&
                    value.sourceCommit === expected.sourceCommit,
                  'HELPER_VERIFY_FAILED',
                  'The updated helper did not verify.',
                );
                resolve();
              } catch (error: unknown) {
                reject(
                  error instanceof Error
                    ? error
                    : new Error('The helper response is invalid.'),
                );
              }
            });
          },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end(JSON.stringify({ operation: 'health', body: {} }));
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new UpdateError(
    'HELPER_VERIFY_FAILED',
    'The updated helper did not become ready.',
  );
}
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
export async function fileHashes(files: Record<string, string>): Promise<void> {
  for (const [path, expected] of Object.entries(files))
    assert(
      digest(await fs.readFile(path)) === expected,
      'CONFIGURATION_DRIFT',
      'A managed deployment configuration file changed.',
    );
}
export async function commitInstallation(
  installation: Installation,
  plan: PersistedPlan,
): Promise<void> {
  const next = structuredClone(installation);
  next.current = plan.targets;
  if (next.compose)
    next.compose.workerImage = plan.targets.backend.artifact.url;
  await atomicWrite(installationPath(), next);
}
