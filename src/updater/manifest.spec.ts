import { OfficialCatalog, officialFetch } from './catalog';
import {
  OfficialRelease,
  isStableRelease,
  satisfies,
  validateManifest,
} from './manifest';
import { testRelease } from './testing';
describe('official release provenance and compatibility', () => {
  const release: OfficialRelease = {
    id: 2,
    tag_name: 'v1.1.0',
    draft: false,
    prerelease: false,
    published_at: '2026-09-29T00:00:00Z',
    assets: [
      {
        name: 'update-manifest.json',
        browser_download_url:
          'https://github.com/databk/rustdesk-console/releases/download/v1.1.0/update-manifest.json',
        size: 1000,
      },
    ],
  };
  test.each([
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: 'nightly' },
    { ...release, tag_name: 'v1.1.0-rc.1' },
    { ...release, tag_name: 'main' },
  ])('rejects non-stable release %j at the server boundary', (value) => {
    expect(isStableRelease(value)).toBe(false);
  });
  test('accepts only pinned official image namespaces and matching source identity', () => {
    const manifest = testRelease('backend', '1.1.0').manifest;
    expect(
      validateManifest(manifest, 'backend', release, manifest.sourceCommit),
    ).toBe(manifest);
    expect(() =>
      validateManifest(
        { ...manifest, sourceCommit: 'c'.repeat(40) },
        'backend',
        release,
        manifest.sourceCommit,
      ),
    ).toThrow('source');
    manifest.artifacts[0].url =
      'ghcr.io/attacker/console@sha256:' + 'b'.repeat(64);
    expect(() =>
      validateManifest(manifest, 'backend', release, manifest.sourceCommit),
    ).toThrow('official');
  });
  test('does not infer peer compatibility from a major version or protocol', () => {
    expect(satisfies('1.5.0', '>=1.3.0 <1.6.0')).toBe(true);
    expect(satisfies('1.5.0', '^1.0.0')).toBe(false);
    expect(satisfies('1.5.0', '>=1.6.0 <2.0.0')).toBe(false);
  });
  test('latest candidate is stable semantic maximum, never prerelease or an older ready release', async () => {
    const manifest = testRelease('backend', '1.1.0').manifest;
    const download = jest.fn((url: string) =>
      Promise.resolve(
        Buffer.from(
          JSON.stringify(
            url.includes('?per_page=')
              ? [
                  release,
                  {
                    ...release,
                    id: 3,
                    tag_name: 'v2.0.0-beta',
                    prerelease: true,
                  },
                ]
              : url.includes('/commits/')
                ? { sha: manifest.sourceCommit }
                : manifest,
          ),
        ),
      ),
    );
    expect(
      (await new OfficialCatalog(download).latest('backend')).version,
    ).toBe('1.1.0');
    download.mockImplementation((url: string) =>
      Promise.resolve(
        Buffer.from(
          JSON.stringify(
            url.includes('?per_page=')
              ? [{ ...release, id: 4, tag_name: 'v1.2.0', assets: [] }, release]
              : manifest,
          ),
        ),
      ),
    );
    await expect(
      new OfficialCatalog(download).latest('backend'),
    ).rejects.toMatchObject({ code: 'MANIFEST_PENDING' });
  });
  test('validates every redirect instead of trusting the initial official URL', async () => {
    const original = global.fetch;
    const fetchMock = jest.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/secrets' },
        }),
      ),
    );
    global.fetch = fetchMock;
    try {
      await expect(
        officialFetch(release.assets[0].browser_download_url),
      ).rejects.toMatchObject({ code: 'UNTRUSTED_SOURCE' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = original;
    }
  });
  test('limits response size even when content-length is absent', async () => {
    const original = global.fetch;
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response('too much data')),
    );
    try {
      await expect(
        officialFetch(release.assets[0].browser_download_url, 4),
      ).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
    } finally {
      global.fetch = original;
    }
  });
});
