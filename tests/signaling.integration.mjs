import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

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
async function openSocket(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 4000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket failed')); }, { once: true });
  });
  return ws;
}
function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), 4000);
    ws.addEventListener('message', event => {
      clearTimeout(timer);
      resolve(JSON.parse(event.data));
    }, { once: true });
  });
}
function send(ws, message) { ws.send(JSON.stringify(message)); }
const room1 = 'ABCDEF2345';
const room2 = 'ABCDEFGH23';
const state = { type: 'state', seq: 2, phase: 'playing', ball: { x: 400, y: 240 },
  leftY: 240, rightY: 240, scoreL: 1, scoreR: 2, countdown: 0, winner: null };

test('automatic discovery, explicit host approval, guarded relay, disconnect and multiple-room listings', async () => {
  const port = await unusedPort();
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const sockets = [];
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error('Server exited unexpectedly');
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { /* Starting up */ }
      if (ready) break;
      await wait(50);
    }
    assert.equal(ready, true, 'server starts');
    const host = await openSocket(port); sockets.push(host);
    const hostCreated = nextMessage(host);
    send(host, { type: 'host:create', room: room1 });
    assert.equal((await hostCreated).type, 'host:created');

    const guest = await openSocket(port); sockets.push(guest);
    const available = nextMessage(guest);
    send(guest, { type: 'guest:discover' });
    assert.deepEqual((await available).rooms.map(r => r.room), [room1]);

    const pendingHost = nextMessage(host);
    const pendingGuest = nextMessage(guest);
    send(guest, { type: 'guest:request', room: room1 });
    const hostRequest = await pendingHost;
    const guestRequest = await pendingGuest;
    assert.equal(hostRequest.type, 'guest:request');
    assert.equal(guestRequest.type, 'guest:pending');
    assert.equal(hostRequest.confirmation, guestRequest.confirmation);

    const wouldBeThird = await openSocket(port); sockets.push(wouldBeThird);
    const noRooms = nextMessage(wouldBeThird);
    send(wouldBeThird, { type: 'guest:discover' });
    assert.equal((await noRooms).rooms.length, 0);

    const joinedHost = nextMessage(host), joinedGuest = nextMessage(guest);
    send(host, { type: 'host:approve', requestId: hostRequest.requestId });
    assert.equal((await joinedHost).type, 'guest:joined');
    assert.equal((await joinedGuest).type, 'guest:joined');

    const inputOnHost = nextMessage(host);
    send(guest, { type: 'relay', data: { type: 'input', y: 205 } });
    assert.deepEqual((await inputOnHost).data, { type: 'input', y: 205 });

    const stateOnGuest = nextMessage(guest);
    send(host, { type: 'relay', data: state });
    assert.deepEqual((await stateOnGuest).data, state);

    const offerOnGuest = nextMessage(guest);
    send(host, { type: 'signal', payload: { description: { type: 'offer', sdp: 'v=0\r\n' } } });
    assert.equal((await offerOnGuest).payload.description.type, 'offer');

    // A third unauthorised client cannot relay game data to an active host.
    send(wouldBeThird, { type: 'relay', data: { type: 'input', y: 133 } });
    const gone = nextMessage(host);
    const availableAgain = nextMessage(wouldBeThird);
    guest.close();
    assert.equal((await gone).type, 'guest:left');

    assert.deepEqual((await availableAgain).rooms.map(r => r.room), [room1]);

    const host2 = await openSocket(port); sockets.push(host2);
    const created2 = nextMessage(host2);
    const updated = nextMessage(wouldBeThird);
    send(host2, { type: 'host:create', room: room2 });
    assert.equal((await created2).type, 'host:created');
    assert.equal((await updated).rooms.length, 2);
  } finally {
    sockets.forEach(ws => ws.close());
    child.kill('SIGTERM');
  }
});
