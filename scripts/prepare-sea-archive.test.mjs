import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareSeaArchive } from './prepare-sea-archive.mjs';

test('node-gyp hard links become independently extractable tar files', (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'sea-hardlinks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, 'bundle');
  fs.mkdirSync(bundle);
  const original = join(bundle, 'native.node');
  const linked = join(bundle, 'native-copy.node');
  fs.writeFileSync(original, 'native-addon-bytes', { mode: 0o755 });
  fs.linkSync(original, linked);
  assert.equal(fs.statSync(original).nlink, 2);
  prepareSeaArchive(bundle);
  assert.equal(fs.statSync(original).nlink, 1);
  assert.equal(fs.statSync(linked).nlink, 1);
  assert.equal(fs.readFileSync(linked, 'utf8'), 'native-addon-bytes');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(linked).mode & 0o777, 0o755);
    const archive = join(root, 'bundle.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', bundle, '.']);
    const listing = execFileSync('tar', ['-tvzf', archive], {
      encoding: 'utf8',
    });
    assert.ok(
      listing
        .trim()
        .split('\n')
        .every((line) => ['-', 'd'].includes(line[0])),
    );
    for (const name of ['native.node', 'native-copy.node'])
      assert.equal(
        execFileSync('tar', ['-xOf', archive, './' + name], {
          encoding: 'utf8',
        }),
        'native-addon-bytes',
      );
  }
});

test(
  'internal file symlinks preserve content and external links are refused',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = fs.mkdtempSync(join(tmpdir(), 'sea-symlinks-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const bundle = join(root, 'bundle');
    fs.mkdirSync(bundle);
    fs.writeFileSync(join(bundle, 'native.node'), 'native-addon-bytes');
    fs.symlinkSync('native.node', join(bundle, 'native-copy.node'));
    prepareSeaArchive(bundle);
    assert.ok(fs.lstatSync(join(bundle, 'native-copy.node')).isFile());
    assert.equal(
      fs.readFileSync(join(bundle, 'native-copy.node'), 'utf8'),
      'native-addon-bytes',
    );
    fs.writeFileSync(join(root, 'outside'), 'outside-bytes');
    fs.symlinkSync('../outside', join(bundle, 'unsafe'));
    assert.throws(() => prepareSeaArchive(bundle), /Unsafe native bundle link/);
  },
);
