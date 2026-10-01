import { Component, OFFICIAL_REPOSITORIES, ReleaseManifest } from './contracts';
import {
  OfficialRelease,
  compareVersions,
  isStableRelease,
  validateManifest,
} from './manifest';
import { assert, UpdateError } from './errors';
export type FetchBytes = (url: string, limit?: number) => Promise<Buffer>;
/** 每次跳转重新核实域名；没有客户端可配置的来源替换。 */
export const officialFetch: FetchBytes = async (
  url,
  limit = 2 * 1024 * 1024,
) => {
  for (let redirect = 0; redirect <= 5; redirect++) {
    const parsed = new URL(url);
    assert(
      parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        [
          'api.github.com',
          'github.com',
          'release-assets.githubusercontent.com',
          'objects.githubusercontent.com',
        ].includes(parsed.hostname),
      'UNTRUSTED_SOURCE',
      'The release redirected outside the official source allowlist.',
    );
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'rustdesk-console-updater/1',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      assert(location, 'UNTRUSTED_SOURCE', 'The release redirect is invalid.');
      url = new URL(location, url).href;
      await response.body?.cancel();
      continue;
    }
    if (response.status === 404)
      throw new UpdateError(
        'RELEASE_UNAVAILABLE',
        'The official release or required manifest is unavailable.',
      );
    assert(
      response.ok,
      'CATALOG_UNAVAILABLE',
      'The official release catalog is temporarily unavailable.',
    );
    assert(
      Number(response.headers.get('content-length') ?? 0) <= limit,
      'ARTIFACT_TOO_LARGE',
      'The official artifact exceeds the supported size.',
    );
    const chunks: Buffer[] = [];
    let size = 0;
    assert(
      response.body,
      'CATALOG_UNAVAILABLE',
      'The release response is empty.',
    );
    for await (const chunk of response.body) {
      size += chunk.length;
      assert(
        size <= limit,
        'ARTIFACT_TOO_LARGE',
        'The official artifact exceeds the supported size.',
      );
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new UpdateError(
    'UNTRUSTED_SOURCE',
    'The release redirected too many times.',
  );
};
export interface Catalog {
  latest(component: Component): Promise<ReleaseManifest>;
  exact(component: Component, releaseId: number): Promise<ReleaseManifest>;
}
export class OfficialCatalog implements Catalog {
  constructor(private readonly download: FetchBytes = officialFetch) {}
  private async json<T>(url: string): Promise<T> {
    return JSON.parse((await this.download(url)).toString('utf8')) as T;
  }
  async latest(component: Component): Promise<ReleaseManifest> {
    const releases: OfficialRelease[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.json<OfficialRelease[]>(
        `https://api.github.com/repos/${OFFICIAL_REPOSITORIES[component]}/releases?per_page=100&page=${page}`,
      );
      assert(
        Array.isArray(batch),
        'CATALOG_UNAVAILABLE',
        'The official release catalog is invalid.',
      );
      releases.push(...batch.filter(isStableRelease));
      if (batch.length < 100) break;
      assert(
        page < 10,
        'CATALOG_LIMIT',
        'The release catalog requires a newer updater.',
      );
    }
    releases.sort((a, b) =>
      compareVersions(
        b.tag_name.replace(/^v/, ''),
        a.tag_name.replace(/^v/, ''),
      ),
    );
    assert(
      releases.length,
      'RELEASE_UNAVAILABLE',
      'No official stable release is available.',
    );
    return this.read(component, releases[0]);
  }
  async exact(
    component: Component,
    releaseId: number,
  ): Promise<ReleaseManifest> {
    assert(
      Number.isSafeInteger(releaseId) && releaseId > 0,
      'INVALID_MANIFEST',
      'The release identity is invalid.',
    );
    const release = await this.json<OfficialRelease>(
      `https://api.github.com/repos/${OFFICIAL_REPOSITORIES[component]}/releases/${releaseId}`,
    );
    return this.read(component, release);
  }
  private async read(
    component: Component,
    release: OfficialRelease,
  ): Promise<ReleaseManifest> {
    assert(
      isStableRelease(release),
      'NON_STABLE_RELEASE',
      'Only official stable releases may be installed.',
    );
    const asset = release.assets?.find(
      (asset) => asset.name === 'update-manifest.json',
    );
    const expected = `https://github.com/${OFFICIAL_REPOSITORIES[component]}/releases/download/${release.tag_name}/update-manifest.json`;
    assert(
      asset?.browser_download_url === expected,
      'MANIFEST_PENDING',
      'The latest official release is not yet ready for automatic updating.',
    );
    const manifest = await this.json<unknown>(expected);
    const commit = await this.json<{ sha: string }>(
      `https://api.github.com/repos/${OFFICIAL_REPOSITORIES[component]}/commits/${encodeURIComponent(release.tag_name)}`,
    );
    return validateManifest(manifest, component, release, commit.sha);
  }
}
