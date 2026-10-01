import * as fs from 'node:fs';
import * as path from 'node:path';

// Both links emitted by npm and hard links emitted by node-gyp must become
// ordinary files before tar runs: the installer deliberately rejects links.
export function prepareSeaArchive(root) {
  const distDir = fs.realpathSync(root);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.name === '.bin' && entry.isDirectory()) {
        fs.rmSync(file, { recursive: true });
      } else if (entry.isSymbolicLink()) {
        const target = fs.realpathSync(file);
        if (
          !target.startsWith(distDir + path.sep) ||
          !fs.statSync(target).isFile()
        )
          throw new Error('Unsafe native bundle link');
        const contents = fs.readFileSync(target);
        const mode = fs.statSync(target).mode & 0o777;
        fs.unlinkSync(file);
        fs.writeFileSync(file, contents, { mode });
      } else if (entry.isDirectory()) {
        visit(file);
      } else if (entry.isFile()) {
        const stat = fs.statSync(file);
        if (stat.nlink > 1) {
          const contents = fs.readFileSync(file);
          fs.unlinkSync(file);
          fs.writeFileSync(file, contents, { mode: stat.mode & 0o777 });
        }
      } else {
        throw new Error('Unsupported native bundle entry');
      }
    }
  }
  visit(distDir);
}
