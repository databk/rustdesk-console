/** Unpublished integration derivatives; reuse the real complete glibc bundle. */
import { build, stop } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const completeBundle = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const entrypoint = path.join(root, 'test-fixture-entrypoint.cjs');
const fixtureBundleSha256 = createHash('sha256')
  .update(fs.readFileSync(entrypoint))
  .digest('hex');
fs.mkdirSync(output, { recursive: true });
const evidence = [];
for (const version of ['1.9.0', '1.9.1']) {
  const directory = path.join(output, version);
  if (fs.existsSync(directory))
    throw new Error('Refusing to overwrite a fixture');
  fs.cpSync(completeBundle, directory, { recursive: true });
  const payload = path.join(output, version + '.cjs');
  let replacements = 0;
  await build({
    entryPoints: [path.join(root, 'dist/main.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: payload,
    external: [
      'sqlite3',
      'sharp',
      '@nestjs/microservices',
      '@nestjs/websockets',
    ],
    plugins: [
      {
        name: 'test-only-updater-constructor',
        setup(builder) {
          builder.onResolve(
            { filter: /^\.\/updater\/entrypoint(?:\.js)?$/ },
            (args) => {
              if (args.importer !== path.join(root, 'dist/main.js')) return;
              replacements += 1;
              return { path: entrypoint };
            },
          );
        },
      },
    ],
    banner: {
      js: 'var originalRequire=require;var seaRequire=require("node:module").createRequire(process.execPath);require=function(id){try{return originalRequire(id)}catch(e){if(e.code==="MODULE_NOT_FOUND"||e.code==="ERR_UNKNOWN_BUILTIN_MODULE")return seaRequire(id);throw e}};',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.APP_VERSION': JSON.stringify(version),
    },
  });
  stop();
  if (replacements !== 1) {
    throw new Error(
      `Expected one test-only updater constructor replacement; found ${replacements}`,
    );
  }
  const blob = path.join(output, version + '.blob');
  const configuration = path.join(output, version + '-sea.json');
  fs.writeFileSync(
    configuration,
    JSON.stringify({
      main: payload,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', configuration], {
    stdio: 'inherit',
  });
  const executable = path.join(directory, 'rustdesk-console');
  fs.copyFileSync(process.execPath, executable);
  execFileSync(
    'npx',
    [
      '--no-install',
      'postject',
      executable,
      'NODE_SEA_BLOB',
      blob,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ],
    { stdio: 'inherit' },
  );
  fs.chmodSync(executable, 0o755);
  const executableBytes = fs.readFileSync(executable);
  for (const marker of [
    'TEST_FIXTURE_REQUIRED',
    'Unknown immutable local fixture',
  ]) {
    if (!executableBytes.includes(Buffer.from(marker))) {
      throw new Error(
        `The generated SEA is missing its test fixture marker: ${marker}`,
      );
    }
  }
  for (const file of [
    'package.json',
    'build-info.json',
    'release-metadata.json',
  ]) {
    const target = path.join(directory, file);
    const metadata = JSON.parse(fs.readFileSync(target, 'utf8'));
    metadata.version = version;
    fs.writeFileSync(target, JSON.stringify(metadata) + '\n');
  }
  const archive = path.join(output, 'backend-' + version + '-linux-x64.tar.gz');
  execFileSync('tar', [
    '--hard-dereference',
    '-C',
    directory,
    '-czf',
    archive,
    ...fs.readdirSync(directory).sort(),
  ]);
  const bytes = fs.readFileSync(archive);
  evidence.push({
    version,
    archive,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fixtureBundleSha256,
    constructorReplacements: replacements,
    provenance: 'unpublished-local-fixture',
  });
}
fs.writeFileSync(
  path.join(output, 'artifacts.json'),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
