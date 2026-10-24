import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerTransport } from '../src/net/transport.ts';

const sample = { type: 'state', seq: 11, phase: 'playing', countdown: 0,
  ball: { x: 400, y: 200 }, leftY: 220, rightY: 235,
  scoreL: 1, scoreR: 2, winner: null };

// A fake WebSocket exercises the actual client protocol without needing npm dependencies.
test('guest automatically discovers WebSocket-only lobby, joins, and exchanges relay gameplay', async () => {
  const nativeWindow = globalThis.window;
  const nativeLocation = globalThis.location;
  const nativeWS = globalThis.WebSocket;
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(data) { this.sent.push(JSON.parse(data)); }
    emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.window = { WebSocket: FakeSocket }; // No RTCPeerConnection: fallback path.
  globalThis.WebSocket = FakeSocket;
  globalThis.location = { protocol: 'https:', host: 'pong.example' };
  try {
    const client = new PeerTransport('guest');
    const statuses = [], modes = [], messages = [], rooms = [], confirmations = [];
    client.onStatus = s => statuses.push(s);
    client.onModeChange = mode => modes.push(mode);
    client.onRooms = list => rooms.push(list);
    client.onMessage = message => messages.push(message);
    client.onConfirmation = code => confirmations.push(code);
    await client.connect();
    await new Promise(resolve => setImmediate(resolve));
    const socket = sockets[0];
    assert.equal(socket.sent[0].type, 'guest:discover');
    socket.emit({ type: 'lobby:update', rooms: [{ room: 'ABCDEF2345', label: 'ARCADE 001' }] });
    assert.equal(rooms[0][0].label, 'ARCADE 001');
    client.requestRoom('ABCDEF2345');
    assert.equal(socket.sent.at(-1).type, 'guest:request');
    socket.emit({ type: 'guest:pending', confirmation: '1234' });
    assert.equal(confirmations.at(-1), '1234');
    socket.emit({ type: 'guest:joined' });
    assert.ok(statuses.includes('connected'));
    assert.equal(modes.at(-1), 'relay');
    assert.equal(client.send({ type: 'input', y: 205 }), true);
    assert.deepEqual(socket.sent.at(-1), { type: 'relay', data: { type: 'input', y: 205 } });
    socket.emit({ type: 'relay', data: sample });
    assert.deepEqual(messages, [sample]);
    socket.emit({ type: 'relay', data: { type: 'input', y: 444 } });
    assert.equal(messages.length, 1, 'reject unexpected peer direction');
    client.close();
    assert.equal(client.send({ type: 'input', y: 230 }), false);
  } finally {
    globalThis.window = nativeWindow;
    globalThis.WebSocket = nativeWS;
    globalThis.location = nativeLocation;
  }
});

test('host starts on relay, negotiates P2P in background, switches and falls back on RTC failure', async () => {
  const saved = {
    window: globalThis.window, location: globalThis.location,
    WebSocket: globalThis.WebSocket, fetch: globalThis.fetch
  };
  let socket;
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor() { socket = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(data) { this.sent.push(JSON.parse(data)); }
    emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  let rtc;
  class FakeRTC {
    constructor() { rtc = this; this.connectionState = 'new'; }
    createDataChannel() { this.channel = { readyState: 'connecting', bufferedAmount: 0, sent: [],
      send(data) { this.sent.push(JSON.parse(data)); }, close() { this.readyState = 'closed'; this.onclose?.(); } }; return this.channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
    async setLocalDescription(description) {
      this.localDescription = { ...description, toJSON: () => description };
    }
    close() { this.connectionState = 'closed'; }
  }
  globalThis.window = { WebSocket: FakeSocket, RTCPeerConnection: FakeRTC };
  globalThis.WebSocket = FakeSocket;
  globalThis.location = { protocol: 'https:', host: 'pong.example' };
  globalThis.RTCPeerConnection = FakeRTC;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ iceServers: [] }) });
  try {
    const host = new PeerTransport('host', 'ABCDEF2345');
    const statuses = [], modes = [], requests = [];
    host.onStatus = status => statuses.push(status);
    host.onModeChange = mode => modes.push(mode);
    host.onPairRequest = request => requests.push(request);
    await host.connect();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(socket.sent[0].type, 'host:create');
    socket.emit({ type: 'host:created', label: 'ARCADE 001' });
    socket.emit({ type: 'guest:request', requestId: 'test-1234', confirmation: '2345' });
    assert.equal(requests.at(-1).confirmation, '2345');
    host.approve('test-1234');
    assert.equal(socket.sent.at(-1).type, 'host:approve');
    socket.emit({ type: 'guest:joined' });
    assert.equal(statuses.at(-1), 'connected');
    assert.equal(modes.at(-1), 'relay');
    assert.ok(host.send(sample));
    assert.equal(socket.sent.at(-1).type, 'relay');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(socket.sent.at(-1).payload.description.type, 'offer');
    rtc.channel.readyState = 'open';
    rtc.channel.onopen();
    assert.equal(modes.at(-1), 'p2p');
    assert.ok(host.send(sample));
    assert.deepEqual(rtc.channel.sent.at(-1), sample);
    rtc.channel.close();
    assert.equal(modes.at(-1), 'relay');
    assert.equal(statuses.at(-1), 'connected', 'no gameplay reset on downgrade');
    assert.ok(host.send(sample));
    assert.equal(socket.sent.at(-1).type, 'relay');
    host.close();
  } finally {
    globalThis.window = saved.window;
    globalThis.WebSocket = saved.WebSocket;
    globalThis.location = saved.location;
    globalThis.RTCPeerConnection = undefined;
    globalThis.fetch = saved.fetch;
  }
});
