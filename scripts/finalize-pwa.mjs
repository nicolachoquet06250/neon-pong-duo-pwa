import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full, base);
    if (!entry.isFile()) return [];
    return [path.relative(base, full).replaceAll(path.sep, '/')];
  });
}

/** Inject Vite's fingerprinted assets into the deployed service worker. */
export function finalizePwa(root = defaultRoot) {
  const dist = path.join(root, 'dist');
  const publicDir = path.join(root, 'public');
  const metaSource = path.join(publicDir, '.well-known', 'meta-wearables-manifest.json');
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('dist/index.html missing. Build Vite first.');
  if (!existsSync(metaSource)) throw new Error('Meta Wearables icon manifest is missing');
  // Copy explicitly: public directory handlers may skip dot-directories.
  cpSync(path.join(publicDir, '.well-known'), path.join(dist, '.well-known'), { recursive: true });
  const workerFile = path.join(dist, 'sw.js');
  const required = [
    'index.html', 'offline.html', 'manifest.webmanifest',
    'icons/pong-192.png', 'icons/pong-512.png',
    'icons/pong-maskable-192.png', 'icons/pong-maskable-512.png',
    'icons/meta-pong.svg', '.well-known/meta-wearables-manifest.json', 'favicon.svg', 'sw.js'
  ];
  for (const item of required) {
    if (!existsSync(path.join(dist, item))) throw new Error(`PWA build missing ${item}`);
  }
  const pwaManifest = JSON.parse(readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
  const metaManifest = JSON.parse(readFileSync(path.join(dist, '.well-known/meta-wearables-manifest.json'), 'utf8'));
  if (pwaManifest.display !== 'standalone' || metaManifest.version !== 1) {
    throw new Error('Invalid PWA/Meta manifests');
  }
  const metaIcon = new URL(metaManifest.appearance.icon.src, 'https://example.test/.well-known/meta-wearables-manifest.json');
  if (!existsSync(path.join(dist, metaIcon.pathname.slice(1)))) throw new Error('Meta manifest icon is missing');
  const files = walk(dist).filter(f => f !== 'sw.js' && !f.endsWith('.map')).sort();
  const cacheVersion = createHash('sha256');
  for (const file of files) {
    cacheVersion.update(file);
    cacheVersion.update(readFileSync(path.join(dist, file)));
  }
  const version = cacheVersion.digest('hex').slice(0, 16);
  const urls = [...new Set(files.map(f => '/' + f))];
  if (!urls.includes('/index.html') || !urls.includes('/offline.html') ||
      !urls.some(item => item.startsWith('/assets/') && item.endsWith('.js'))) {
    throw new Error('PWA shell must include HTML, offline fallback and compiled JS');
  }
  let worker = readFileSync(workerFile, 'utf8');
  if (!worker.includes('__NEON_PONG_CACHE_VERSION__') || !worker.includes('"__NEON_PONG_PRECACHE_LIST__"')) {
    throw new Error('Expected service worker build placeholders not found');
  }
  worker = worker.replaceAll('__NEON_PONG_CACHE_VERSION__', version)
    .replace('"__NEON_PONG_PRECACHE_LIST__"', JSON.stringify(urls));
  writeFileSync(workerFile, worker);
  console.log(`PWA ready: ${urls.length} offline assets, cache ${version}, Meta Wearables icon present`);
  return { version, urls };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) finalizePwa();
