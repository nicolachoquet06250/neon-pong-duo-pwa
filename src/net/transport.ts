import type { Snapshot } from '../core/engine.ts';
import { NETWORK } from '../config/constants.ts';

export type Role = 'host' | 'guest';
export type TransportMode = 'relay' | 'p2p';
export type PeerMessage = Snapshot | { type: 'input'; y: number };
export type Status = 'connecting' | 'discovering' | 'waiting' | 'approval' | 'connected' | 'disconnected' | 'error';
export interface AvailableRoom { room: string; label: string }
export interface PairRequest { requestId: string; confirmation: string }

interface SignalPacket {
  type: string;
  code?: string;
  label?: string;
  rooms?: AvailableRoom[];
  requestId?: string;
  confirmation?: string;
  payload?: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  data?: PeerMessage;
}

function decodeGame(packet: unknown): PeerMessage | null {
  if (!packet || typeof packet !== 'object') return null;
  const message = packet as {
    type?: string; y?: number; seq?: number; phase?: Snapshot['phase'];
    ball?: { x: number; y: number }; leftY?: number; rightY?: number;
    countdown?: number; scoreL?: number; scoreR?: number; winner?: Snapshot['winner'];
  };
  if (message.type === 'input' && typeof message.y === 'number' &&
      Number.isFinite(message.y) && message.y >= 0 && message.y <= 480) {
    return { type: 'input', y: message.y };
  }
  if (message.type === 'state' && Number.isSafeInteger(message.seq) &&
      ['waiting', 'countdown', 'playing', 'gameover'].includes(message.phase ?? '') &&
      Number.isFinite(message.ball?.x) && Number.isFinite(message.ball?.y) &&
      Number.isFinite(message.leftY) && Number.isFinite(message.rightY) &&
      Number.isFinite(message.countdown) && Number.isSafeInteger(message.scoreL) &&
      Number.isSafeInteger(message.scoreR) && (message.scoreL ?? -1) >= 0 &&
      (message.scoreR ?? -1) >= 0 && (message.scoreL ?? 100) <= 99 &&
      (message.scoreR ?? 100) <= 99) return message as Snapshot;
  return null;
}

/** Anonymous discovery and confirmed pairing over WSS; gameplay prefers RTCDataChannel. */
export class PeerTransport {
  onStatus: (status: Status, details?: string) => void = () => {};
  onMessage: (message: PeerMessage) => void = () => {};
  onRooms: (rooms: AvailableRoom[]) => void = () => {};
  onLobbyName: (name: string) => void = () => {};
  onPairRequest: (request: PairRequest | null) => void = () => {};
  onConfirmation: (code: string | null) => void = () => {};
  onModeChange: (mode: TransportMode) => void = () => {};
  private ws: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private candidates: RTCIceCandidateInit[] = [];
  private iceConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  private stopped = false;
  private paired = false;
  private mode: TransportMode = 'relay';

  constructor(readonly role: Role, readonly room?: string) {}

  async connect(): Promise<void> {
    this.onStatus('connecting');
    if (!('WebSocket' in window)) throw new Error('WebSocket not supported');
    // STUN/TURN config is optional. A browser without WebRTC plays over WebSocket.
    if ('RTCPeerConnection' in window) {
      try {
        const response = await fetch('/api/ice-config', { cache: 'no-store' });
        if (response.ok) this.iceConfig = await response.json() as RTCConfiguration;
      } catch { /* Relay remains available if ICE configuration fails. */ }
    }
    if (this.stopped) return;
    this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws.onopen = () => {
      if (this.role === 'host') this.sendSignal({ type: 'host:create', room: this.room });
      else this.sendSignal({ type: 'guest:discover' });
    };
    this.ws.onmessage = event => { void this.handleSignal(event.data as string).catch(() => {
      // WebRTC setup errors are non-fatal; WebSocket gameplay is already enabled.
      this.fallback();
    }); };
    this.ws.onerror = () => { if (!this.stopped) this.onStatus('error', 'Signalisation inaccessible'); };
    this.ws.onclose = () => {
      if (!this.stopped) {
        this.paired = false;
        this.disposePeer();
        this.onStatus('disconnected', 'Connexion au serveur fermée');
      }
    };
  }

  requestRoom(room: string): void {
    if (this.role !== 'guest' || !/^[A-HJ-NP-Z2-9]{10}$/.test(room)) return;
    this.sendSignal({ type: 'guest:request', room });
  }

  approve(requestId: string): void { this.sendSignal({ type: 'host:approve', requestId }); }
  reject(requestId: string): void { this.sendSignal({ type: 'host:reject', requestId }); }
  cancelRequest(): void { this.sendSignal({ type: 'guest:cancel' }); }

  private sendSignal(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private async handleSignal(data: string): Promise<void> {
    if (this.stopped || data.length > 16384) return;
    let packet: SignalPacket;
    try { packet = JSON.parse(data) as SignalPacket; } catch { return; }
    if (packet.type === 'error') {
      // A racing lobby request is recoverable without closing the WebSocket.
      if (packet.code === 'room_unavailable' && this.role === 'guest') {
        this.onStatus('discovering', packet.code); return;
      }
      this.onStatus('error', packet.code); return;
    }
    if (packet.type === 'host:created') {
      if (packet.label && packet.label.length <= 40) this.onLobbyName(packet.label);
      this.onStatus('waiting'); return;
    }
    if (packet.type === 'lobby:update' && this.role === 'guest') {
      const rooms = Array.isArray(packet.rooms) ? packet.rooms.filter(r =>
        typeof r.room === 'string' && /^[A-HJ-NP-Z2-9]{10}$/.test(r.room) &&
        typeof r.label === 'string' && r.label.length <= 40) : [];
      this.onRooms(rooms); return;
    }
    if (packet.type === 'guest:request' && this.role === 'host' &&
        typeof packet.requestId === 'string' && typeof packet.confirmation === 'string') {
      this.onPairRequest({ requestId: packet.requestId, confirmation: packet.confirmation });
      return;
    }
    if (packet.type === 'guest:pending' && this.role === 'guest') {
      this.onConfirmation(packet.confirmation ?? null);
      this.onStatus('approval'); return;
    }
    if (packet.type === 'guest:rejected' || packet.type === 'guest:timeout' ||
        packet.type === 'guest:cancelled') {
      this.onConfirmation(null); this.onPairRequest(null);
      this.onStatus(this.role === 'guest' ? 'discovering' : 'waiting', packet.type);
      return;
    }
    if (packet.type === 'guest:joined') {
      this.paired = true;
      this.onPairRequest(null); this.onConfirmation(null);
      this.mode = 'relay';
      this.onModeChange('relay');
      this.onStatus('connected');
      if (this.role === 'host' && 'RTCPeerConnection' in window) {
        void this.offer().catch(() => this.fallback());
      }
      return;
    }
    if (packet.type === 'guest:left' || packet.type === 'host:left') {
      this.paired = false;
      this.disposePeer();
      this.mode = 'relay';
      this.onPairRequest(null); this.onConfirmation(null);
      this.onStatus(this.role === 'host' ? 'waiting' : 'disconnected', 'Partenaire déconnecté');
      return;
    }
    if (packet.type === 'relay' && this.paired) {
      const message = decodeGame(packet.data);
      if (message && ((this.role === 'guest' && message.type === 'state') ||
                      (this.role === 'host' && message.type === 'input'))) this.onMessage(message);
      return;
    }
    if (packet.type !== 'signal' || !packet.payload || !this.paired || !('RTCPeerConnection' in window)) return;
    if (packet.payload.description) {
      const description = packet.payload.description;
      if (description.type === 'offer' && this.role === 'guest') {
        const earlyCandidates = this.candidates;
        this.disposePeer(); this.candidates = earlyCandidates;
        const peer = this.createPeer();
        await peer.setRemoteDescription(description);
        await this.flushCandidates(peer);
        await peer.setLocalDescription(await peer.createAnswer());
        this.sendSignal({ type: 'signal', payload: { description: peer.localDescription?.toJSON() } });
      } else if (description.type === 'answer' && this.role === 'host' && this.peer) {
        await this.peer.setRemoteDescription(description);
        await this.flushCandidates(this.peer);
      }
    }
    if (packet.payload.candidate) {
      if (this.peer?.remoteDescription) await this.peer.addIceCandidate(packet.payload.candidate);
      else this.candidates.push(packet.payload.candidate);
    }
  }

  private async offer(): Promise<void> {
    this.disposePeer();
    const peer = this.createPeer();
    this.bindChannel(peer.createDataChannel('pong', { ordered: true }));
    await peer.setLocalDescription(await peer.createOffer());
    this.sendSignal({ type: 'signal', payload: { description: peer.localDescription?.toJSON() } });
  }

  private createPeer(): RTCPeerConnection {
    const peer = new RTCPeerConnection(this.iceConfig);
    this.peer = peer;
    peer.onicecandidate = event => {
      if (event.candidate && this.peer === peer) {
        this.sendSignal({ type: 'signal', payload: { candidate: event.candidate.toJSON() } });
      }
    };
    peer.ondatachannel = event => this.bindChannel(event.channel);
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer || this.stopped) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') this.fallback();
    };
    return peer;
  }

  private async flushCandidates(peer: RTCPeerConnection): Promise<void> {
    const queued = this.candidates.splice(0);
    for (const candidate of queued) {
      try { await peer.addIceCandidate(candidate); } catch { /* Ignore stale ICE candidate. */ }
    }
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => {
      if (!this.stopped && this.paired) {
        this.mode = 'p2p';
        this.onModeChange('p2p');
      }
    };
    channel.onclose = () => this.fallback();
    channel.onerror = () => this.fallback();
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > NETWORK.maxMessage) return;
      try {
        const message = decodeGame(JSON.parse(event.data));
        if (message && ((this.role === 'guest' && message.type === 'state') ||
                        (this.role === 'host' && message.type === 'input'))) this.onMessage(message);
      } catch { /* Ignore malformed messages. */ }
    };
  }

  private fallback(): void {
    if (this.stopped || this.mode !== 'p2p') return;
    this.mode = 'relay';
    this.onModeChange('relay');
  }

  send(message: PeerMessage): boolean {
    if (!this.paired) return false;
    const content = JSON.stringify(message);
    if (content.length > NETWORK.maxMessage) return false;
    if (this.mode === 'p2p' && this.channel?.readyState === 'open' &&
        this.channel.bufferedAmount <= 128 * 1024) {
      this.channel.send(content); return true;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSignal({ type: 'relay', data: message }); return true;
    }
    return false;
  }

  private disposePeer(): void {
    const channel = this.channel;
    const peer = this.peer;
    this.channel = null; this.peer = null;
    if (channel) { channel.onclose = null; channel.onerror = null; channel.onmessage = null; channel.close(); }
    peer?.close();
    this.candidates = [];
  }

  close(): void {
    this.stopped = true;
    this.paired = false;
    this.disposePeer();
    this.ws?.close(); this.ws = null;
  }
}
