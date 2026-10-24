import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerTransport, type AvailableRoom, type PairRequest, type PeerMessage, type Status, type TransportMode } from './transport.ts';

const snapshot = {
  type: 'state' as const,
  seq: 11,
  phase: 'playing' as const,
  countdown: 0,
  ball: { x: 400, y: 200 },
  leftY: 220,
  rightY: 235,
  scoreL: 1,
  scoreR: 2,
  winner: null,
};

type WirePacket = { type: string; [key: string]: unknown };
let sockets: FakeSocket[];

class FakeSocket {
  static readonly OPEN = 1;
  readyState = 0;
  readonly sent: WirePacket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string): void { this.sent.push(JSON.parse(data) as WirePacket); }
  emit(packet: WirePacket): void { this.onmessage?.({ data: JSON.stringify(packet) }); }
  close(): void { this.readyState = 3; this.onclose?.(); }
}

class FakeDataChannel {
  readyState = 'connecting';
  bufferedAmount = 0;
  readonly sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  send(data: string): void { this.sent.push(JSON.parse(data) as unknown); }
  close(): void { this.readyState = 'closed'; this.onclose?.(); }
}

let activeRtc: FakeRTC | undefined;
class FakeRTC {
  connectionState = 'new';
  channel!: FakeDataChannel;
  localDescription: (RTCSessionDescriptionInit & { toJSON: () => RTCSessionDescriptionInit }) | null = null;

  constructor() { activeRtc = this; }
  createDataChannel(): FakeDataChannel { this.channel = new FakeDataChannel(); return this.channel; }
  async createOffer(): Promise<RTCSessionDescriptionInit> { return { type: 'offer', sdp: 'v=0\r\n' }; }
  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = { ...description, toJSON: () => description };
  }
  close(): void { this.connectionState = 'closed'; }
}

function mockBrowser(withRtc = false): void {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('window', withRtc ? { WebSocket: FakeSocket, RTCPeerConnection: FakeRTC } : { WebSocket: FakeSocket });
  vi.stubGlobal('location', { protocol: 'https:', host: 'pong.example' });
  if (withRtc) {
    vi.stubGlobal('RTCPeerConnection', FakeRTC);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ iceServers: [] }) })));
  }
}

const flushEvents = async (): Promise<void> => { await new Promise<void>(resolve => setImmediate(resolve)); };

beforeEach(() => { sockets = []; activeRtc = undefined; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('PeerTransport', () => {
  it('discovers a WebSocket-only room, joins and relays only expected gameplay messages', async () => {
    mockBrowser();
    const client = new PeerTransport('guest');
    const statuses: Status[] = [];
    const modes: TransportMode[] = [];
    const messages: PeerMessage[] = [];
    const rooms: AvailableRoom[][] = [];
    const confirmations: (string | null)[] = [];
    client.onStatus = status => statuses.push(status);
    client.onModeChange = mode => modes.push(mode);
    client.onRooms = list => rooms.push(list);
    client.onMessage = message => messages.push(message);
    client.onConfirmation = code => confirmations.push(code);

    try {
      await client.connect();
      await flushEvents();
      const socket = sockets[0];
      expect(socket.sent[0].type).toBe('guest:discover');
      socket.emit({ type: 'lobby:update', rooms: [{ room: 'ABCDEF2345', label: 'ARCADE 001' }] });
      expect(rooms[0][0].label).toBe('ARCADE 001');
      client.requestRoom('ABCDEF2345');
      expect(socket.sent.at(-1)?.type).toBe('guest:request');
      socket.emit({ type: 'guest:pending', confirmation: '1234' });
      expect(confirmations.at(-1)).toBe('1234');
      socket.emit({ type: 'guest:joined' });
      expect(statuses).toContain('connected');
      expect(modes.at(-1)).toBe('relay');
      expect(client.send({ type: 'input', y: 205 })).toBe(true);
      expect(socket.sent.at(-1)).toEqual({ type: 'relay', data: { type: 'input', y: 205 } });
      socket.emit({ type: 'relay', data: snapshot });
      expect(messages).toEqual([snapshot]);
      socket.emit({ type: 'relay', data: { type: 'input', y: 444 } });
      expect(messages).toHaveLength(1);
    } finally {
      client.close();
    }
    expect(client.send({ type: 'input', y: 230 })).toBe(false);
  });

  it('switches from WebSocket to WebRTC and falls back without disconnecting the match', async () => {
    mockBrowser(true);
    const host = new PeerTransport('host', 'ABCDEF2345');
    const statuses: Status[] = [];
    const modes: TransportMode[] = [];
    const requests: PairRequest[] = [];
    host.onStatus = status => statuses.push(status);
    host.onModeChange = mode => modes.push(mode);
    host.onPairRequest = request => { if (request) requests.push(request); };

    try {
      await host.connect();
      await flushEvents();
      const socket = sockets[0];
      expect(socket.sent[0].type).toBe('host:create');
      socket.emit({ type: 'host:created', label: 'ARCADE 001' });
      socket.emit({ type: 'guest:request', requestId: 'test-1234', confirmation: '2345' });
      expect(requests.at(-1)?.confirmation).toBe('2345');
      host.approve('test-1234');
      expect(socket.sent.at(-1)?.type).toBe('host:approve');
      socket.emit({ type: 'guest:joined' });
      expect(statuses.at(-1)).toBe('connected');
      expect(modes.at(-1)).toBe('relay');
      expect(host.send(snapshot)).toBe(true);
      expect(socket.sent.at(-1)?.type).toBe('relay');
      await flushEvents();
      expect((socket.sent.at(-1)?.payload as { description: RTCSessionDescriptionInit }).description.type).toBe('offer');
      const rtc = activeRtc;
      expect(rtc).toBeDefined();
      if (!rtc) throw new Error('FakeRTC was not created');
      rtc.channel.readyState = 'open';
      rtc.channel.onopen?.();
      expect(modes.at(-1)).toBe('p2p');
      expect(host.send(snapshot)).toBe(true);
      expect(rtc.channel.sent.at(-1)).toEqual(snapshot);
      rtc.channel.close();
      expect(modes.at(-1)).toBe('relay');
      expect(statuses.at(-1)).toBe('connected');
      expect(host.send(snapshot)).toBe(true);
      expect(socket.sent.at(-1)?.type).toBe('relay');
    } finally {
      host.close();
    }
  });
});
