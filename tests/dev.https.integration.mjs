import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { WebSocket } from 'ws';
import { localIpv4Addresses } from '../server/local-network.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function unusedPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
function get(port, pathname = '/api/health') {
  return new Promise((resolve, reject) => {
    https.get({ hostname: '127.0.0.1', port, path: pathname,
      rejectUnauthorized: false }, res => {
      const certificate = res.socket.getPeerCertificate();
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode,
        body: Buffer.concat(chunks).toString(), certificate }));
    }).on('error', reject);
  });
}

test('npm run dev serves HTTPS API, WSS lobby and Vite frontend on one port', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'neon-pong-tls-'));
  const port = await unusedPort();
  const child = spawn(process.execPath, ['server/index.mjs', '--dev'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '0.0.0.0', DEV_TLS_DIR: dir,
      DEV_TLS_HOSTS: '', DEV_TLS_KEY: '', DEV_TLS_CERT: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  let ws;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Server exited unexpectedly: ${output}`);
      try { ready = (await get(port)).status === 200; } catch { /* still starting */ }
      if (ready) break;
      await wait(100);
    }
    assert.equal(ready, true, `HTTPS server did not start: ${output}`);
    const health = await get(port);
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true });
    const peerCertificate = new X509Certificate(health.certificate.raw);
    assert.equal(peerCertificate.checkHost('localhost'), 'localhost');
    assert.equal(peerCertificate.checkIP('127.0.0.1'), '127.0.0.1');
    for (const address of localIpv4Addresses()) {
      assert.equal(peerCertificate.checkIP(address), address, `LAN IP ${address} must be in the certificate SAN`);
    }

    const page = await get(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /<html|<!doctype html/i);
    const viteClient = await get(port, '/@vite/client');
    assert.equal(viteClient.status, 200, 'Vite HMR client must be available over HTTPS');

    ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WSS handshake timeout')), 4000);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const message = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WSS lobby response timeout')), 4000);
      ws.once('message', raw => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); });
    });
    ws.send(JSON.stringify({ type: 'guest:discover' }));
    const lobby = await message;
    assert.equal(lobby.type, 'lobby:update');
    assert.ok(Array.isArray(lobby.rooms));
  } finally {
    ws?.close();
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});
