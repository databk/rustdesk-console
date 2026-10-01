import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const targets = [
  ['linux-x64', 'x64', 'glibc'],
  ['linux-arm64', 'arm64', 'glibc'],
  ['linux-x64-musl', 'x64', 'musl'],
  ['linux-arm64-musl', 'arm64', 'musl'],
];

export function finalize({
  release,
  docker,
  peerRange,
  artifactsDir,
  readBuildInfo,
}) {
  const version = release.tag_name?.replace(/^v/, '');
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    release.draft ||
    release.prerelease ||
    !release.published_at
  ) {
    throw new Error('Only a published stable release can be finalized');
  }
  if (
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    !Number.isFinite(Date.parse(release.published_at))
  )
    throw new Error('Invalid release identity');
  if (!/^[a-f0-9]{40}$/.test(docker.sourceCommit) || docker.version !== version)
    throw new Error('Docker version/commit does not match release');
  if (
    !/^(?:(?:>=|>|<=|<|=)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?: +(?:>=|>|<=|<|=)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))*$/.test(
      peerRange,
    )
  )
    throw new Error('An explicit tested peer version range is required');
  if (
    !/^sha256:[a-f0-9]{64}$/.test(docker.digest) ||
    !Number.isSafeInteger(docker.size) ||
    docker.size <= 0
  )
    throw new Error('Missing immutable Docker descriptor');
  const artifacts = targets.map(([target, arch, libc]) => {
    const name = `rustdesk-console-${target}.tar.gz`;
    const file = join(artifactsDir, name);
    const asset = release.assets?.find((item) => item.name === name);
    if (
      !asset ||
      asset.state !== 'uploaded' ||
      asset.size !== statSync(file).size
    )
      throw new Error(`Incomplete release asset: ${name}`);
    const expectedUrl = `https://github.com/databk/rustdesk-console/releases/download/${release.tag_name}/${name}`;
    if (asset.browser_download_url !== expectedUrl)
      throw new Error('Unexpected artifact source');
    const info = readBuildInfo(file);
    if (
      info.component !== 'backend' ||
      info.version !== version ||
      info.sourceCommit !== docker.sourceCommit ||
      info.bundleFormat !== 1 ||
      info.platform !== 'linux' ||
      info.arch !== arch ||
      info.libc !== libc
    )
      throw new Error(`Artifact build identity mismatch: ${name}`);
    const sha256 = createHash('sha256')
      .update(readFileSync(file))
      .digest('hex');
    if (asset.digest && asset.digest !== `sha256:${sha256}`)
      throw new Error(`Uploaded artifact digest mismatch: ${name}`);
    return {
      kind: 'archive',
      platform: { os: 'linux', arch, libc },
      name,
      url: expectedUrl,
      sha256,
      size: asset.size,
    };
  });
  for (const arch of ['x64', 'arm64']) {
    if (
      !docker.platforms?.includes(`linux/${arch === 'x64' ? 'amd64' : 'arm64'}`)
    )
      throw new Error('Docker platform evidence is incomplete');
    artifacts.push({
      kind: 'oci',
      platform: { os: 'linux', arch, libc: 'musl' },
      name: `backend-linux-${arch}`,
      url: `ghcr.io/databk/rustdesk-console@${docker.digest}`,
      sha256: docker.digest.slice(7),
      size: docker.size,
    });
  }
  return {
    schemaVersion: 1,
    repository: 'databk/rustdesk-console',
    component: 'backend',
    version,
    releaseId: release.id,
    tag: release.tag_name,
    sourceCommit: docker.sourceCommit,
    publishedAt: release.published_at,
    peerVersionRange: peerRange,
    updaterProtocol: 1,
    maintenanceProtocol: 1,
    bundleFormat: 1,
    artifacts,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const at = arg.indexOf('=');
      if (!arg.startsWith('--') || at < 0)
        throw new Error('Use --name=value arguments');
      return [arg.slice(2, at), arg.slice(at + 1)];
    }),
  );
  const manifest = finalize({
    release: JSON.parse(readFileSync(args.release, 'utf8')),
    docker: JSON.parse(readFileSync(args.docker, 'utf8')),
    peerRange: args['peer-range'],
    artifactsDir: args.artifacts,
    readBuildInfo: (file) =>
      JSON.parse(
        execFileSync('tar', ['-xOf', file, './build-info.json'], {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        }),
      ),
  });
  writeFileSync(args.out, JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
}
