import {
  OFFICIAL_REPOSITORIES,
  ReleaseManifest,
  Component,
  Platform,
  ReleaseArtifact,
} from './contracts';
import { assert } from './errors';
export const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(left: string, right: string): number {
  assert(
    STABLE_VERSION.test(left) && STABLE_VERSION.test(right),
    'UNKNOWN_VERSION',
    'Only stable semantic versions are supported.',
  );
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
export function satisfies(version: string, range: string): boolean {
  const terms = range.trim().split(/\s+/);
  return (
    terms.length > 0 &&
    terms.every((term) => {
      const match =
        /^(>=|<=|>|<|=)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(
          term,
        );
      if (!match) return false;
      const value = compareVersions(version, match[2]);
      switch (match[1] ?? '=') {
        case '>=':
          return value >= 0;
        case '<=':
          return value <= 0;
        case '>':
          return value > 0;
        case '<':
          return value < 0;
        default:
          return value === 0;
      }
    })
  );
}
export interface OfficialRelease {
  id: number;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}
export function isStableRelease(release: OfficialRelease): boolean {
  return (
    release.draft === false &&
    release.prerelease === false &&
    STABLE_VERSION.test(release.tag_name.replace(/^v/, '')) &&
    Number.isSafeInteger(release.id) &&
    release.id > 0 &&
    Boolean(release.published_at)
  );
}
export function assertArtifact(
  artifact: ReleaseArtifact,
  component: Component,
  tag: string,
): void {
  assert(
    artifact &&
      artifact.platform?.os === 'linux' &&
      ['x64', 'arm64'].includes(artifact.platform.arch) &&
      ['glibc', 'musl'].includes(artifact.platform.libc),
    'INVALID_ARTIFACT',
    'The release platform is unsupported.',
  );
  assert(
    /^[a-f0-9]{64}$/.test(artifact.sha256) &&
      Number.isSafeInteger(artifact.size) &&
      artifact.size > 0,
    'INVALID_ARTIFACT',
    'The release artifact has no valid integrity metadata.',
  );
  if (artifact.kind === 'oci') {
    assert(
      artifact.url ===
        `ghcr.io/${OFFICIAL_REPOSITORIES[component]}@sha256:${artifact.sha256}`,
      'UNTRUSTED_SOURCE',
      'Only digest-pinned official images are accepted.',
    );
  } else {
    assert(
      artifact.kind === 'archive' &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$/.test(artifact.name),
      'INVALID_ARTIFACT',
      'The release archive format is unsupported.',
    );
    assert(
      artifact.url ===
        `https://github.com/${OFFICIAL_REPOSITORIES[component]}/releases/download/${tag}/${artifact.name}`,
      'UNTRUSTED_SOURCE',
      'Only official release archives are accepted.',
    );
  }
}
export function validateManifest(
  value: unknown,
  component: Component,
  release: OfficialRelease,
  commit: string,
): ReleaseManifest {
  const manifest = value as ReleaseManifest;
  assert(
    isStableRelease(release),
    'NON_STABLE_RELEASE',
    'The selected release is not an official stable release.',
  );
  assert(
    manifest &&
      manifest.schemaVersion === 1 &&
      manifest.component === component &&
      manifest.repository === OFFICIAL_REPOSITORIES[component],
    'INVALID_MANIFEST',
    'The official update manifest is invalid.',
  );
  assert(
    manifest.releaseId === release.id &&
      manifest.tag === release.tag_name &&
      manifest.version === release.tag_name.replace(/^v/, '') &&
      manifest.publishedAt === release.published_at,
    'RELEASE_CHANGED',
    'The release identity changed. Preview the update again.',
  );
  assert(
    /^[a-f0-9]{40}$/.test(manifest.sourceCommit) &&
      manifest.sourceCommit === commit,
    'RELEASE_CHANGED',
    'The release source does not match its tag.',
  );
  assert(
    manifest.updaterProtocol === 1 &&
      manifest.maintenanceProtocol === 1 &&
      manifest.bundleFormat === 1,
    'PROTOCOL_UNSUPPORTED',
    'The release requires an unsupported updater protocol.',
  );
  assert(
    typeof manifest.peerVersionRange === 'string' &&
      manifest.peerVersionRange.length < 200 &&
      manifest.peerVersionRange
        .trim()
        .split(/\s+/)
        .every((term) =>
          /^(>=|<=|>|<|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(
            term,
          ),
        ),
    'COMPATIBILITY_MISSING',
    'The release has no supported explicit compatibility range.',
  );
  assert(
    Array.isArray(manifest.artifacts) &&
      manifest.artifacts.length > 0 &&
      manifest.artifacts.length <= 32,
    'ARTIFACTS_PENDING',
    'The release artifacts are not complete.',
  );
  for (const artifact of manifest.artifacts) {
    assertArtifact(artifact, component, release.tag_name);
    if (artifact.kind === 'archive')
      assert(
        release.assets.some(
          (asset) =>
            asset.name === artifact.name &&
            asset.browser_download_url === artifact.url &&
            asset.size === artifact.size,
        ),
        'ARTIFACTS_PENDING',
        'A declared release archive is missing.',
      );
  }
  return manifest;
}
export function selectArtifact(
  manifest: ReleaseManifest,
  platform: Platform,
  kind: 'oci' | 'archive',
): ReleaseArtifact {
  const artifacts = manifest.artifacts.filter(
    (artifact) =>
      artifact.kind === kind &&
      artifact.platform.os === platform.os &&
      artifact.platform.arch === platform.arch &&
      artifact.platform.libc === platform.libc,
  );
  assert(
    artifacts.length === 1,
    'ARTIFACTS_PENDING',
    'Exactly one artifact for this installation platform is required.',
  );
  return artifacts[0];
}
