/**
 * Node.js SEA (Single Executable Application) build script.
 *
 * Steps:
 * 1. Compile TypeScript with nest build
 * 2. Bundle the compiled output with esbuild (native modules as external)
 * 3. Generate the SEA blob from the bundle
 * 4. Copy the Node.js binary and inject the blob
 * 5. Assemble the distribution directory with templates and native modules
 */
import { build } from 'esbuild';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const exeName = isWindows ? 'rustdesk-console.exe' : 'rustdesk-console';

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: rootDir, ...opts });
}

function copyDir(src, dest) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  Copied ${path.relative(rootDir, src)} -> ${path.relative(rootDir, dest)}`);
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
  banner: {
    js: [
      '// SEA require patch: route external module loads through createRequire',
      'var __origRequire = require;',
      'var __createRequire = require("module").createRequire;',
      'var __seaRequire = __createRequire(process.execPath);',
      'require = function(id) {',
      '  try { return __origRequire(id); }',
      '  catch (e) {',
      '    if (e.code === "ERR_UNKNOWN_BUILTIN_MODULE") return __seaRequire(id);',
      '    throw e;',
      '  }',
      '};',
    ].join('\n'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});

// --- Step 3: Generate SEA blob ---
console.log('\n[3/6] Generating SEA blob...');
run('node --experimental-sea-config sea-config.json');

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
      'powershell -NoProfile -Command "(Get-ChildItem \'C:\\\\Program Files (x86)\\\\Windows Kits\\\\10\\\\bin\' -Recurse -Filter \'signtool.exe\' -ErrorAction SilentlyContinue | Where-Object { $_.DirectoryName -match \'x64\' } | Select-Object -First 1).FullName"',
      { encoding: 'utf-8' },
    ).trim();
    if (signtool) {
      run(`"${signtool}" remove /s "${exeName}"`);
    } else {
      console.warn('  Warning: signtool.exe not found, continuing without signature removal');
    }
  } catch {
    console.warn('  Warning: signtool not found or failed, continuing without signature removal');
  }
}

run(`npx postject "${exeName}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);

// --- Step 5: Assemble distribution directory ---
console.log('\n[5/6] Assembling distribution...');
const distDir = path.join(rootDir, 'dist-sea');
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// Copy the SEA executable
fs.copyFileSync(exePath, path.join(distDir, exeName));
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

// Copy minimal package.json (for version info)
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'),
);
fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify({ name: pkgJson.name, version: pkgJson.version }, null, 2) + '\n',
);
console.log('  Wrote dist-sea/package.json');

// --- Step 6: Install native modules ---
console.log('\n[6/6] Installing native modules (sqlite3, sharp)...');
const nativePkg = {
  name: 'rustdesk-console-sea',
  version: pkgJson.version,
  private: true,
  dependencies: {
    sqlite3: pkgJson.dependencies.sqlite3,
    sharp: pkgJson.dependencies.sharp,
  },
};
fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify(nativePkg, null, 2) + '\n',
);

run('npm install --omit=dev', { cwd: distDir });

// Remove the temporary package-lock.json to keep the dist clean
fs.rmSync(path.join(distDir, 'package-lock.json'), { force: true });

// --- Cleanup intermediate files ---
console.log('\nCleaning up...');
fs.unlinkSync(exePath);
fs.unlinkSync(path.join(rootDir, 'sea-bundle.cjs'));
fs.unlinkSync(path.join(rootDir, 'sea-prep.blob'));

console.log('\n========================================');
console.log('SEA build complete!');
console.log(`Distribution: ${distDir}`);
console.log('========================================');
