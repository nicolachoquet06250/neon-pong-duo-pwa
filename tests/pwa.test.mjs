import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { finalizePwa } from '../scripts/finalize-pwa.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PWA and Meta Wearables icon manifests describe valid resources', () => {
  const manifest = JSON.parse(readFileSync(path.join(source, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) assert.ok(readFileSync(path.join(source, 'public', icon.src.slice(1))).length > 500);
  const meta = JSON.parse(readFileSync(path.join(source, 'public/.well-known/meta-wearables-manifest.json'), 'utf8'));
  assert.equal(meta.version, 1);
  assert.ok(meta.appearance.theme_color);
  const resolved = new URL(meta.appearance.icon.src, 'https://example.test/.well-known/meta-wearables-manifest.json');
  assert.equal(resolved.pathname, '/icons/meta-pong.svg');
  assert.match(readFileSync(path.join(source, 'public', resolved.pathname.slice(1)), 'utf8'), /<svg/);
});

test('compiled worker precaches Vite fingerprinted assets and Meta app icon', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'neon-pong-pwa-'));
  try {
    mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
    cpSync(path.join(source, 'public'), path.join(root, 'public'), { recursive: true });
    cpSync(path.join(root, 'public'), path.join(root, 'dist'), { recursive: true });
    writeFileSync(path.join(root, 'dist/index.html'), '<html>pong</html>');
    writeFileSync(path.join(root, 'dist/assets/index-a3b5c7.js'), 'console.log("pong")');
    writeFileSync(path.join(root, 'dist/assets/style-a3b5c7.css'), 'body{}');
    const { version, urls } = finalizePwa(root);
    assert.ok(urls.includes('/.well-known/meta-wearables-manifest.json'));
    assert.ok(urls.includes('/assets/index-a3b5c7.js'));
    assert.ok(urls.includes('/offline.html'));
    const worker = readFileSync(path.join(root, 'dist/sw.js'), 'utf8');
    assert.ok(worker.includes(version));
    assert.ok(!worker.includes('__NEON_PONG_'));
    assert.doesNotThrow(() => new vm.Script(worker));
    assert.equal(worker.includes('/api/health'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worker excludes multiplayer API and WS from caching', () => {
  const worker = readFileSync(path.join(source, 'public/sw.js'), 'utf8');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/ws'\)/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /cache\.match\('\/index\.html'\)/);
});

test('offline screen and recovery are wired without changing platform detection', () => {
  const html = readFileSync(path.join(source, 'src/index.html'), 'utf8');
  const main = readFileSync(path.join(source, 'src/main.ts'), 'utf8');
  assert.match(html, /id="offlineScreen"/);
  assert.match(main, /addEventListener\('offline'/);
  assert.match(main, /addEventListener\('online'/);
  assert.match(main, /register\('\/sw\.js'/);
  assert.match(main, /detectDeviceMode\(navigator\.userAgent\)/);
});


test('service worker serves the cached shell offline, without intercepting the multiplayer API', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'neon-pong-runtime-'));
  try {
    mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
    cpSync(path.join(source, 'public'), path.join(root, 'public'), { recursive: true });
    cpSync(path.join(root, 'public'), path.join(root, 'dist'), { recursive: true });
    writeFileSync(path.join(root, 'dist/index.html'), '<html>cached Pong</html>');
    writeFileSync(path.join(root, 'dist/assets/index-a3b5c7.js'), '/* works offline */');
    finalizePwa(root);
    const worker = readFileSync(path.join(root, 'dist/sw.js'), 'utf8');
    const listeners = {};
    const store = new Map();
    const makeCache = () => ({
      addAll: async urls => {
        for (const url of urls) store.set(url, new Response(url === '/index.html' ? 'cached Pong' : `cached ${url}`));
      },
      match: async request => store.get(typeof request === 'string' ? request : new URL(request.url).pathname),
      put: async (request, response) => { store.set(new URL(request.url).pathname, response); }
    });
    const context = vm.createContext({
      self: {
        location: { origin: 'https://pong.example.test' },
        addEventListener: (name, fn) => { listeners[name] = fn; },
        skipWaiting: async () => {}, clients: { claim: async () => {} }
      },
      caches: { open: async () => makeCache(), keys: async () => [], delete: async () => {} },
      fetch: async () => { throw new Error('offline'); },
      Response, URL
    });
    vm.runInContext(worker, context);
    let installing;
    listeners.install({ waitUntil: work => { installing = work; } });
    await installing;
    assert.ok(store.has('/assets/index-a3b5c7.js'));
    let result;
    listeners.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://pong.example.test/' },
      respondWith: response => { result = response; } });
    assert.equal(await (await result).text(), 'cached Pong');
    let intercepted = false;
    listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://pong.example.test/api/health' },
      respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
    assert.ok(!store.has('/api/health'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
