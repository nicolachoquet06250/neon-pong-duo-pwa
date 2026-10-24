import http from 'node:http';
import https from 'node:https';
import { loadDevTls } from './dev-tls.mjs';
import { localIpv4Addresses } from './local-network.mjs';
import { diagnosticHTML, isDiagnosticPath } from './diagnostics.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const host = process.env.HOST || process.env.IP || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const dev = process.argv.includes('--dev');
const ttlMs = 15 * 60 * 1000;
const approvalMs = 45 * 1000;
const rooms = new Map();
const seekers = new Set();
let roomCounter = 0;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  iceServers.push({ urls: process.env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean),
    username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
}
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};

let vite;
const handleRequest = (req, res) => {
  const url = new URL(req.url || '/', `${dev ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
  // Log only relevant dev requests, enough to see if the glasses reached the server.
  if (dev && (url.pathname === '/' || url.pathname === '/diagnostic' ||
      url.pathname === '/main.ts' || url.pathname === '/@vite/client')) {
    res.once('finish', () => console.info(`[HTTP] ${req.method} ${url.pathname} → ${res.statusCode}`));
  }
  // Intentionally served before Vite: no CSS, bundled JS or WebGL dependencies.
  if (isDiagnosticPath(url.pathname, url.searchParams)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(diagnosticHTML);
  }
  if (url.pathname === '/api/ice-config') return json(res, 200, { iceServers });
  if (url.pathname === '/api/health') return json(res, 200, { ok: true });
  if (dev) return vite.middlewares(req, res, () => json(res, 404, { error: 'not_found' }));
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'invalid_path' }); }
  const candidate = path.resolve(dist, '.' + pathname);
  if (!(candidate === dist || candidate.startsWith(dist + path.sep))) return json(res, 403, { error: 'forbidden' });
  const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate :
    (path.extname(pathname) || pathname.startsWith('/.well-known/')) ? null : path.join(dist, 'index.html');
  if (!file) return json(res, 404, { error: 'asset_not_found' });
  fs.readFile(file, (err, buffer) => {
    if (err) return json(res, 404, { error: 'build_missing_run_npm_build' });
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': ['index.html', 'sw.js', 'manifest.webmanifest', 'meta-wearables-manifest.json'].includes(path.basename(file)) ? 'no-cache' : 'public, max-age=3600' });
    res.end(buffer);
  });
};

// The same HTTPS server hosts Vite, WSS signaling and the WebRTC relay.
// Keeping Vite HMR on this exact server avoids an insecure ws:// HMR connection.
const server = dev
  ? https.createServer(await loadDevTls(root), handleRequest)
  : http.createServer(handleRequest);
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({
    configFile: path.join(root, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server, protocol: 'wss', clientPort: port } },
    appType: 'spa'
  });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
const send = (ws, message) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
};
const isRoom = code => typeof code === 'string' && /^[A-HJ-NP-Z2-9]{10}$/.test(code);
const isSignal = payload => payload && typeof payload === 'object' && (
  (['offer', 'answer'].includes(payload.description?.type) &&
    typeof payload.description.sdp === 'string' && payload.description.sdp.length < 12000) ||
  (payload.candidate && typeof payload.candidate.candidate === 'string' &&
    payload.candidate.candidate.length < 2000));
const isGame = (message, role) => {
  if (!message || typeof message !== 'object') return false;
  if (role === 'guest') return message.type === 'input' &&
    typeof message.y === 'number' && Number.isFinite(message.y) && message.y >= 0 && message.y <= 480;
  if (role !== 'host') return false;
  return message.type === 'state' && Number.isSafeInteger(message.seq) &&
    ['waiting', 'countdown', 'playing', 'gameover'].includes(message.phase) &&
    Number.isFinite(message.ball?.x) && Number.isFinite(message.ball?.y) &&
    Number.isFinite(message.leftY) && Number.isFinite(message.rightY) &&
    Number.isFinite(message.countdown) && Number.isSafeInteger(message.scoreL) &&
    Number.isSafeInteger(message.scoreR) && message.scoreL >= 0 && message.scoreL <= 99 &&
    message.scoreR >= 0 && message.scoreR <= 99;
};
const listRooms = () => [...rooms.values()]
  .filter(room => !room.guest && !room.pending && room.host.readyState === WebSocket.OPEN)
  .map(room => ({ room: room.code, label: `ARCADE ${String(room.number).padStart(3, '0')}` }));
const updateLobby = () => {
  const available = listRooms();
  for (const ws of seekers) send(ws, { type: 'lobby:update', rooms: available });
};
const releasePending = (room, reason = 'guest:cancelled') => {
  if (!room.pending) return;
  const pending = room.pending;
  room.pending = null;
  pending.guest.roomCode = null;
  pending.guest.role = 'seeker';
  seekers.add(pending.guest);
  send(pending.guest, { type: reason });
  send(room.host, { type: 'guest:cancelled' });
  updateLobby();
};

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  // Let Vite's own HMR upgrade listener handle its WebSocket path in development.
  if (url.pathname !== '/ws') { if (!dev) socket.destroy(); return; }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) { socket.destroy(); return; }
    } catch { socket.destroy(); return; }
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
  ws.role = null;
  ws.roomCode = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let windowTime = Date.now();
  let trafficCount = 0;
  ws.on('message', buffer => {
    if (Date.now() - windowTime > 1000) { windowTime = Date.now(); trafficCount = 0; }
    if (++trafficCount > 60) return ws.close(1008, 'rate_limited');
    let message;
    try { message = JSON.parse(buffer.toString()); } catch { return send(ws, { type: 'error', code: 'invalid_json' }); }
    if (!message || typeof message !== 'object') return;

    if (!ws.role && message.type === 'host:create' && isRoom(message.room)) {
      if (rooms.has(message.room)) return send(ws, { type: 'error', code: 'room_taken' });
      ws.role = 'host'; ws.roomCode = message.room;
      rooms.set(message.room, { code: message.room, number: ++roomCounter,
        host: ws, guest: null, pending: null, touched: Date.now() });
      send(ws, { type: 'host:created', label: `ARCADE ${String(roomCounter).padStart(3, '0')}` });
      updateLobby();
      return;
    }
    if (!ws.role && message.type === 'guest:discover') {
      ws.role = 'seeker'; seekers.add(ws);
      send(ws, { type: 'lobby:update', rooms: listRooms() });
      return;
    }
    if (ws.role === 'seeker' && message.type === 'guest:request' && isRoom(message.room)) {
      const room = rooms.get(message.room);
      if (!room || room.guest || room.pending || room.host.readyState !== WebSocket.OPEN) {
        return send(ws, { type: 'error', code: 'room_unavailable' });
      }
      const requestId = `${Date.now()}-${randomInt(1000000000)}`;
      const confirmation = String(randomInt(1000, 10000));
      room.pending = { guest: ws, requestId, confirmation, since: Date.now() };
      room.touched = Date.now();
      ws.role = 'pending'; ws.roomCode = room.code; seekers.delete(ws);
      send(ws, { type: 'guest:pending', confirmation });
      send(room.host, { type: 'guest:request', requestId, confirmation });
      updateLobby();
      return;
    }
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    room.touched = Date.now();
    if (ws.role === 'host' && room.host === ws) {
      if (message.type === 'host:approve' && room.pending?.requestId === message.requestId) {
        const guest = room.pending.guest;
        room.pending = null; room.guest = guest;
        guest.role = 'guest';
        send(guest, { type: 'guest:joined' });
        send(ws, { type: 'guest:joined' });
        updateLobby();
        return;
      }
      if (message.type === 'host:reject' && room.pending?.requestId === message.requestId) {
        releasePending(room, 'guest:rejected'); return;
      }
    }
    if (ws.role === 'pending' && room.pending?.guest === ws && message.type === 'guest:cancel') {
      releasePending(room); return;
    }
    const paired = (ws.role === 'host' && room.host === ws && room.guest) ||
      (ws.role === 'guest' && room.guest === ws);
    if (!paired) return;
    const other = ws.role === 'host' ? room.guest : room.host;
    if (message.type === 'signal' && isSignal(message.payload)) {
      send(other, { type: 'signal', payload: message.payload });
    } else if (message.type === 'relay' && isGame(message.data, ws.role) &&
               JSON.stringify(message.data).length <= 4096) {
      send(other, { type: 'relay', data: message.data });
    }
  });
  ws.on('close', () => {
    seekers.delete(ws);
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (room.host === ws) {
      if (room.pending) {
        const guest = room.pending.guest;
        guest.role = 'seeker'; guest.roomCode = null;
        seekers.add(guest); send(guest, { type: 'host:left' });
      }
      send(room.guest, { type: 'host:left' });
      rooms.delete(room.code); updateLobby();
    } else if (room.pending?.guest === ws) {
      room.pending = null; send(room.host, { type: 'guest:cancelled' }); updateLobby();
    } else if (room.guest === ws) {
      room.guest = null;
      send(room.host, { type: 'guest:left' }); updateLobby();
    }
  });
});

const sweep = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  for (const room of rooms.values()) {
    if (room.pending && Date.now() - room.pending.since > approvalMs) releasePending(room, 'guest:timeout');
    if (!room.guest && !room.pending && Date.now() - room.touched > ttlMs) {
      send(room.host, { type: 'error', code: 'room_expired' }); room.host.close();
      rooms.delete(room.code); updateLobby();
    }
  }
}, 15000);
sweep.unref();
server.listen(port, host, () => {
  const scheme = dev ? 'https' : 'http';
  process.stdout.write(`Neon Pong ${dev ? 'dev' : 'production'} listening on ${host}:${port}\n`);
  if (host === '0.0.0.0') {
    process.stdout.write(`  Local:   ${scheme}://localhost:${port}\n`);
    const addresses = localIpv4Addresses();
    for (const address of addresses) {
      process.stdout.write(`  Network: ${scheme}://${address}:${port}\n`);
    }
    if (addresses.length === 0) process.stdout.write('  No LAN IPv4 address detected.\n');
  } else {
    process.stdout.write(`  Address: ${scheme}://${host}:${port}\n`);
  }
  if (dev) process.stdout.write('The development TLS certificate is self-signed: phones and glasses may reject it until trusted.\n');
});
