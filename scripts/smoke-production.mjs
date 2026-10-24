import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
for (const file of ['dist/index.html', 'server/index.mjs', 'node_modules/ws/package.json', 'dist/sw.js', 'dist/manifest.webmanifest', 'dist/.well-known/meta-wearables-manifest.json', 'dist/icons/meta-pong.svg']) {
  if (!existsSync(path.join(build, file))) throw new Error(`Missing deployment artifact: build/${file}`);
}
const pkg = JSON.parse(readFileSync(path.join(build, 'package.json'), 'utf8'));
if (pkg.devDependencies) throw new Error('Deployment package.json must not include devDependencies.');

async function getPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
const port = await getPort();
const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: build,
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', IP: '', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', data => { serverOutput += data.toString(); });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
      if (health.ok && (await health.json()).ok === true) { ready = true; break; }
    } catch { /* server not listening yet */ }
    await delay(100);
  }
  if (!ready) throw new Error(`Packaged Node.js server did not start:\n${serverOutput}`);
  const response = await fetch(`http://127.0.0.1:${port}/`);
  if (!response.ok || !(await response.text()).includes('<html')) {
    throw new Error(`Packaged frontend was not served (HTTP ${response.status}).`);
  }
  for (const [route, expectedContentType] of [
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/sw.js', 'text/javascript'],
    ['/.well-known/meta-wearables-manifest.json', 'application/json'],
    ['/icons/meta-pong.svg', 'image/svg+xml']
  ]) {
    const asset = await fetch(`http://127.0.0.1:${port}${route}`);
    if (!asset.ok || !asset.headers.get('content-type')?.includes(expectedContentType)) {
      throw new Error(`Invalid PWA asset ${route}: HTTP ${asset.status}, ${asset.headers.get('content-type')}`);
    }
  }
  const sw = await (await fetch(`http://127.0.0.1:${port}/sw.js`)).text();
  if (sw.includes('__NEON_PONG_PRECACHE_LIST__')) throw new Error('Service worker precache list not compiled');
  console.log('Production smoke test OK: server + API + app + service worker + Meta Wearables icon');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(1500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
