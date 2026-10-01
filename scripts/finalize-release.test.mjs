import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { test } from 'node:test';
import { finalize } from './finalize-release.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'console-finalize-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commit = 'a'.repeat(40);
  const infos = new Map();
  const assets = [];
  for (const [target, arch, libc] of [
    ['linux-x64', 'x64', 'glibc'],
    ['linux-arm64', 'arm64', 'glibc'],
    ['linux-x64-musl', 'x64', 'musl'],
    ['linux-arm64-musl', 'arm64', 'musl'],
  ]) {
    const name = 'rustdesk-console-' + target + '.tar.gz';
    const info = {
      component: 'backend',
      version: '1.10.0',
      sourceCommit: commit,
      bundleFormat: 1,
      platform: 'linux',
      arch,
      libc,
    };
    const contents = JSON.stringify(info);
    writeFileSync(join(directory, name), contents);
    infos.set(name, info);
    assets.push({
      name,
      state: 'uploaded',
      size: Buffer.byteLength(contents),
      digest: 'sha256:' + createHash('sha256').update(contents).digest('hex'),
      browser_download_url:
        'https://github.com/databk/rustdesk-console/releases/download/1.10.0/' +
        name,
    });
  }
  return {
    release: {
      id: 42,
      tag_name: '1.10.0',
      draft: false,
      prerelease: false,
      published_at: '2026-09-29T00:00:00Z',
      assets,
    },
    docker: {
      sourceCommit: commit,
      version: '1.10.0',
      digest: 'sha256:' + 'b'.repeat(64),
      size: 1234,
      platforms: ['linux/amd64', 'linux/arm64'],
    },
    peerRange: '>=1.7.0 <2.0.0',
    artifactsDir: directory,
    readBuildInfo: (file) => infos.get(basename(file)),
  };
}

test('finalizes only a complete matching release with exact digests', (t) => {
  const input = fixture(t);
  const manifest = finalize(input);
  assert.equal(manifest.artifacts.length, 6);
  assert.equal(manifest.sourceCommit, input.docker.sourceCommit);
  assert.equal(
    manifest.artifacts[4].url,
    'ghcr.io/databk/rustdesk-console@' + input.docker.digest,
  );
  assert.equal(
    manifest.artifacts[0].sha256,
    input.release.assets[0].digest.slice(7),
  );
});

for (const [label, mutate] of [
  [
    'prerelease',
    (i) => {
      i.release.prerelease = true;
    },
  ],
  [
    'draft',
    (i) => {
      i.release.draft = true;
    },
  ],
  [
    'nightly tag',
    (i) => {
      i.release.tag_name = 'nightly';
    },
  ],
  [
    'missing artifact',
    (i) => {
      i.release.assets.pop();
    },
  ],
  [
    'unfinished artifact',
    (i) => {
      i.release.assets[0].state = 'uploading';
    },
  ],
  [
    'artifact tampering',
    (i) => {
      i.release.assets[0].digest = 'sha256:' + 'f'.repeat(64);
    },
  ],
  [
    'foreign asset',
    (i) => {
      i.release.assets[0].browser_download_url = 'https://evil.test/file';
    },
  ],
  [
    'version mismatch',
    (i) => {
      i.docker.version = '1.9.0';
    },
  ],
  [
    'commit mismatch',
    (i) => {
      i.docker.sourceCommit = 'c'.repeat(40);
    },
  ],
  [
    'missing Docker architecture',
    (i) => {
      i.docker.platforms = ['linux/amd64'];
    },
  ],
  [
    'implicit compatibility',
    (i) => {
      i.peerRange = '^1';
    },
  ],
]) {
  test('rejects ' + label, (t) => {
    const input = fixture(t);
    mutate(input);
    assert.throws(() => finalize(input));
  });
}
