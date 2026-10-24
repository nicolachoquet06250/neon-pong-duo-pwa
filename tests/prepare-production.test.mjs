import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareProduction } from '../scripts/prepare-production.mjs';

const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'neon-pong-package-'));
  mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
  mkdirSync(path.join(root, 'server'), { recursive: true });
  writeFileSync(path.join(root, 'dist', 'index.html'), '<html>pong</html>');
  writeFileSync(path.join(root, 'dist', 'assets', 'main.js'), 'console.log("pong")');
  writeFileSync(path.join(root, 'server', 'index.mjs'), 'console.log("server")');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'pong', version: '1.1.9', type: 'module', dependencies: { ws: '^8.18.3' },
    devDependencies: { vite: '^7.1.0' }
  }));
  return root;
};

test('packages static assets and native server with runtime-only dependencies', () => {
  const root = fixture();
  try {
    const target = prepareProduction(root);
    assert.equal(readFileSync(path.join(target, 'dist/index.html'), 'utf8'), '<html>pong</html>');
    assert.ok(existsSync(path.join(target, 'dist/assets/main.js')));
    assert.ok(existsSync(path.join(target, 'server/index.mjs')));
    const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dependencies, { ws: '^8.18.3' });
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.scripts.start, 'node server/index.mjs');
    writeFileSync(path.join(target, 'obsolete.txt'), 'stale');
    prepareProduction(root);
    assert.equal(existsSync(path.join(target, 'obsolete.txt')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses to package before the frontend has been built', () => {
  const root = fixture();
  try {
    rmSync(path.join(root, 'dist'), { recursive: true });
    assert.throws(() => prepareProduction(root), /Run npm run build first/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
