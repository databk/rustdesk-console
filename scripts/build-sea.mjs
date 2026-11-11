/**
 * Build a SEA distribution or an OpenWrt private Node runtime bundle.
 *
 * Steps:
 * 1. Compile TypeScript with nest build
 * 2. Bundle the compiled output with esbuild (native modules as external)
 * 3. Generate and inject the SEA blob (skipped for --runtime-bundle)
 * 4. Copy the Node.js binary
 * 5. Assemble the distribution directory with templates and native modules
 */
import { build, stop } from 'esbuild';
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { prepareSeaArchive } from './prepare-sea-archive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const isMacos = process.platform === 'darwin';
const exeName = isWindows ? 'rustdesk-console.exe' : 'rustdesk-console';
const runtimeBundle = process.argv.includes('--runtime-bundle');
if (
  runtimeBundle &&
  (process.platform !== 'linux' ||
    !['x64', 'arm64'].includes(process.arch) ||
    process.report.getReport().header.glibcVersionRuntime)
) {
  throw new Error(
    'build:openwrt requires a Linux musl x64 or arm64 Node runtime',
  );
}
const packageInfo = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
);
const sourceCommit =
  process.env.SOURCE_COMMIT ||
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit))
  throw new Error('A full source commit is required');
if (process.env.APP_VERSION && process.env.APP_VERSION !== packageInfo.version)
  throw new Error('APP_VERSION differs from package.json');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: rootDir, ...opts });
}

function copyDir(src, dest) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(
      `  Copied ${path.relative(rootDir, src)} -> ${path.relative(rootDir, dest)}`,
    );
  }
}

// --- Step 1: Build the application ---
console.log('\n[1/6] Building application...');
run('npm run build');

// --- Step 2: Bundle with esbuild ---
console.log('\n[2/6] Bundling with esbuild...');
await build({
  entryPoints: [path.join(rootDir, 'dist/main.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: path.join(rootDir, 'sea-bundle.cjs'),
  external: [
    // Native addons (cannot be embedded in SEA blob, loaded from node_modules at runtime)
    'sqlite3',
    'sharp',
    // NestJS optional peer dependencies (not installed, but referenced by @nestjs/core)
    '@nestjs/microservices',
    '@nestjs/websockets',
  ],
  banner: runtimeBundle
    ? undefined
    : {
        js: [
          '// SEA require patch: route external module loads through createRequire',
          'var __origRequire = require;',
          'var __createRequire = require("module").createRequire;',
          'var __seaRequire = __createRequire(process.execPath);',
          'require = function(id) {',
          '  try { return __origRequire(id); }',
          '  catch (e) {',
          '    if (e.code === "MODULE_NOT_FOUND" || e.code === "ERR_UNKNOWN_BUILTIN_MODULE") return __seaRequire(id);',
          '    throw e;',
          '  }',
          '};',
        ].join('\n'),
      },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.APP_VERSION': JSON.stringify(packageInfo.version),
    'process.env.SOURCE_COMMIT': JSON.stringify(sourceCommit),
    'process.env.CONSOLE_RUNTIME_BUNDLE': runtimeBundle ? '"1"' : 'undefined',
  },
  logLevel: 'info',
});
stop();

// --- Step 3: Generate SEA blob ---
if (runtimeBundle) {
  console.log(
    '\n[3/6] Using the unmodified Node runtime (no SEA injection)...',
  );
} else {
  console.log('\n[3/6] Generating SEA blob...');
  run('node --experimental-sea-config sea-config.json');
}

// --- Step 4: Copy Node binary and inject blob ---
console.log('\n[4/6] Preparing executable...');
const exePath = path.join(rootDir, exeName);
fs.copyFileSync(process.execPath, exePath);
console.log(`  Copied Node.js binary -> ${exeName}`);

// Remove signature on Windows (Node binary is code-signed)
if (isWindows) {
  console.log('  Removing signature from executable...');
  try {
    const signtool = execSync(
      "powershell -NoProfile -Command \"(Get-ChildItem 'C:\\\\Program Files (x86)\\\\Windows Kits\\\\10\\\\bin' -Recurse -Filter 'signtool.exe' -ErrorAction SilentlyContinue | Where-Object { $_.DirectoryName -match 'x64' } | Select-Object -First 1).FullName\"",
      { encoding: 'utf-8' },
    ).trim();
    if (signtool) {
      run(`"${signtool}" remove /s "${exeName}"`);
    } else {
      console.warn(
        '  Warning: signtool.exe not found, continuing without signature removal',
      );
    }
  } catch {
    console.warn(
      '  Warning: signtool not found or failed, continuing without signature removal',
    );
  }
}

// Remove signature on macOS (Node binary is signed, must be removed before injection)
if (isMacos) {
  console.log('  Removing signature from executable...');
  run(`codesign --remove-signature "${exeName}"`);
}

if (!runtimeBundle) {
  run(
    `npx postject "${exeName}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  );
}

// Re-sign ad-hoc on macOS so the modified binary can run
if (isMacos) {
  console.log('  Re-signing executable ad-hoc...');
  run(`codesign --sign - "${exeName}"`);
}

// --- Step 5: Assemble distribution directory ---
console.log('\n[5/6] Assembling distribution...');
const distDir = path.join(rootDir, 'dist-sea');
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// Keep a common launcher name for either distribution format.
if (runtimeBundle) {
  fs.copyFileSync(exePath, path.join(distDir, 'node'));
  fs.copyFileSync(
    path.join(rootDir, 'sea-bundle.cjs'),
    path.join(distDir, 'console.cjs'),
  );
  fs.writeFileSync(
    path.join(distDir, exeName),
    [
      '#!/bin/sh',
      'bundle="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'exec "$bundle/node" "$bundle/console.cjs" "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
} else {
  fs.copyFileSync(exePath, path.join(distDir, exeName));
}
console.log(`  Copied ${exeName} -> dist-sea/`);

// Copy templates
const templatesDir = path.join(distDir, 'templates');
fs.mkdirSync(path.join(templatesDir, 'email'), { recursive: true });
fs.mkdirSync(path.join(templatesDir, 'oidc'), { recursive: true });

copyDir(
  path.join(rootDir, 'dist/modules/email/templates'),
  path.join(templatesDir, 'email'),
);
copyDir(
  path.join(rootDir, 'dist/modules/oidc/templates'),
  path.join(templatesDir, 'oidc'),
);
if (process.platform === 'linux' && !runtimeBundle) {
  const deploymentDir = path.join(distDir, 'deployment');
  fs.mkdirSync(deploymentDir, { recursive: true });
  for (const file of [
    'install-linux.sh',
    'install_linux.py',
    'rustdesk-console-recover',
  ]) {
    fs.copyFileSync(
      path.join(rootDir, 'deployment', file),
      path.join(deploymentDir, file),
    );
  }
  copyDir(
    path.join(rootDir, 'deployment/systemd'),
    path.join(deploymentDir, 'systemd'),
  );
  for (const file of ['install-linux.sh', 'rustdesk-console-recover']) {
    fs.chmodSync(path.join(deploymentDir, file), 0o755);
  }
}
fs.writeFileSync(
  path.join(distDir, 'build-info.json'),
  JSON.stringify({
    component: 'backend',
    version: packageInfo.version,
    sourceCommit,
    bundleFormat: 1,
    ...(runtimeBundle ? { runtime: 'private-node' } : {}),
    platform: process.platform,
    arch: process.arch,
    libc:
      process.platform === 'linux'
        ? process.report.getReport().header.glibcVersionRuntime
          ? 'glibc'
          : 'musl'
        : null,
  }) + '\n',
);
fs.writeFileSync(
  path.join(distDir, 'release-metadata.json'),
  JSON.stringify({ version: packageInfo.version, sourceCommit }) + '\n',
);

// --- Step 6: Install native modules ---
console.log('\n[6/6] Installing native modules (sqlite3, sharp)...');
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'),
);
const nativePkg = {
  name: pkgJson.name,
  version: pkgJson.version,
  description: pkgJson.description,
  author: pkgJson.author,
  license: pkgJson.license,
  private: true,
  dependencies: {
    sqlite3: JSON.parse(
      fs.readFileSync(
        path.join(rootDir, 'node_modules/sqlite3/package.json'),
        'utf8',
      ),
    ).version,
    sharp: JSON.parse(
      fs.readFileSync(
        path.join(rootDir, 'node_modules/sharp/package.json'),
        'utf8',
      ),
    ).version,
  },
};
fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify(nativePkg, null, 2) + '\n',
);
console.log('  Wrote dist-sea/package.json');

run('npm install --omit=dev', { cwd: distDir });
if (
  process.platform === 'linux' &&
  process.report.getReport().header.glibcVersionRuntime
) {
  // Published addons can require newer glibc than the release build baseline.
  run('npm rebuild sqlite3 --build-from-source', { cwd: distDir });
}
execFileSync(
  process.execPath,
  ['-e', "require('sqlite3'); require('sharp');"],
  {
    cwd: distDir,
    stdio: 'inherit',
  },
);

// Keep the native dependency lockfile as part of the complete release bundle.
if (
  !fs.existsSync(
    path.join(distDir, 'node_modules/sqlite3/build/Release/node_sqlite3.node'),
  )
) {
  throw new Error('The complete bundle is missing the sqlite3 native addon');
}

prepareSeaArchive(distDir);
if (runtimeBundle || process.argv.includes('--verify')) {
  execFileSync(process.execPath, ['scripts/test-runtime.mjs', distDir], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

// --- Cleanup intermediate files ---
console.log('\nCleaning up...');
fs.unlinkSync(exePath);
fs.unlinkSync(path.join(rootDir, 'sea-bundle.cjs'));
if (!runtimeBundle) fs.unlinkSync(path.join(rootDir, 'sea-prep.blob'));

console.log('\n========================================');
console.log(
  runtimeBundle ? 'OpenWrt runtime build complete!' : 'SEA build complete!',
);
console.log(`Distribution: ${distDir}`);
console.log('========================================');
