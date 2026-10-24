import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Stage the compiled frontend, native Node server and production manifest in build/. */
export function prepareProduction(root = defaultRoot) {
  const distDir = path.join(root, 'dist');
  const serverDir = path.join(root, 'server');
  const buildDir = path.join(root, 'build');
  if (!existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('dist/index.html is missing. Run npm run build first.');
  }
  if (!existsSync(path.join(serverDir, 'index.mjs'))) {
    throw new Error('server/index.mjs is missing.');
  }
  const { name, version, engines, dependencies } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!dependencies?.ws) throw new Error('The production dependency ws is missing.');

  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  cpSync(distDir, path.join(buildDir, 'dist'), { recursive: true });
  cpSync(serverDir, path.join(buildDir, 'server'), {
    recursive: true,
    filter: file => !file.includes(`${path.sep}.cert${path.sep}`)
  });
  writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({
    name, version, private: true, type: 'module', engines, dependencies,
    scripts: { start: 'node server/index.mjs' }
  }, null, 2) + '\n');
  return buildDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Prepared ${prepareProduction()} (frontend, Node.js server, production manifest)`);
}
