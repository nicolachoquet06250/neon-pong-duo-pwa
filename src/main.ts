import './style.css';
import { FIELD, NETWORK } from './config/constants.ts';
import { PongGame, newRoom, clamp } from './core/engine.ts';
import { PeerTransport } from './net/transport.ts';
import type { Role, Status, AvailableRoom, PairRequest, TransportMode } from './net/transport.ts';
import { PaddleInput } from './input/paddleInput.ts';
import { DomPong } from './render/domPong.ts';
import { pickLang, t } from './i18n.ts';
import { detectDeviceMode } from './platform.ts';
import type { CopyKey } from './i18n.ts';

const lang = pickLang();
const deviceMode = detectDeviceMode(navigator.userAgent);
document.documentElement.lang = lang;
document.documentElement.dataset.deviceMode = deviceMode;
const el = <T extends HTMLElement>(id: string): T => {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing element: ${id}`);
  return item as T;
};
const intro = el<HTMLElement>('intro');
const offlineScreen = el<HTMLElement>('offlineScreen');
const roomPanel = el<HTMLElement>('roomPanel');
const gameSection = el<HTMLElement>('gameSection');
const hostInvite = el<HTMLElement>('hostInvite');
const guestInvite = el<HTMLElement>('guestInvite');
const hostPair = el<HTMLElement>('hostPair');
const hostLobbyName = el<HTMLElement>('hostLobbyName');
const hostPairCode = el<HTMLElement>('hostPairCode');
const guestPair = el<HTMLElement>('guestPair');
const guestPairCode = el<HTMLElement>('guestPairCode');
const availableRooms = el<HTMLElement>('availableRooms');
const roomTitle = el<HTMLElement>('roomTitle');
const roomHint = el<HTMLElement>('roomHint');
const roomStatus = el<HTMLElement>('roomStatus');
const gameStatus = el<HTMLElement>('gameStatus');
const roomTransport = el<HTMLElement>('roomTransport');
const gameTransport = el<HTMLElement>('gameTransport');
const score = el<HTMLElement>('score');
const banner = el<HTMLElement>('roundBanner');
const controlHelp = el<HTMLElement>('controlHelp');
const startBtn = el<HTMLButtonElement>('startGame');
const replayBtn = el<HTMLButtonElement>('replay');
const stage = el<HTMLElement>('stage');
const board = el<HTMLElement>('board');

for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  node.textContent = t(lang, node.dataset.i18n as CopyKey);
}
let transport: PeerTransport | null = null;
let role: Role | null = null;
let renderer: DomPong | null = null;
let input: PaddleInput | null = null;
let game = new PongGame();
let view = game.snapshot();
let guestY = FIELD.height / 2;
let lastRemoteSeq = 0;
let raf = 0;
let lastFrame = 0;
let lastSend = 0;
let lastInput = 0;
let inputTimer: ReturnType<typeof setTimeout> | undefined;
let isConnected = false;
let inMatch = false;
let pendingRequest: PairRequest | null = null;
let guestRequesting = false;
let blockedRoom: string | null = null;
let requestedRoom: string | null = null;
let available: AvailableRoom[] = [];

function only(panel: 'intro' | 'room' | 'game' | 'offline'): void {
  intro.classList.toggle('hidden', panel !== 'intro');
  offlineScreen.classList.toggle('hidden', panel !== 'offline');
  roomPanel.classList.toggle('hidden', panel !== 'room');
  gameSection.classList.toggle('hidden', panel !== 'game');
  if (panel === 'game') {
    ensureRenderer();
    input!.enabled = true;
    requestAnimationFrame(() => { renderer?.resize(); renderer?.draw(view); stage.focus({ preventScroll: true }); });
  } else if (input) input.enabled = false;
}
function status(message: string, error = false): void {
  for (const target of [roomStatus, gameStatus]) {
    target.textContent = message;
    target.classList.toggle('error', error);
  }
}
function setMode(mode: TransportMode): void {
  const label = t(lang, mode === 'p2p' ? 'modeP2p' : 'modeRelay');
  roomTransport.textContent = label;
  gameTransport.textContent = label;
  roomTransport.dataset.mode = gameTransport.dataset.mode = mode;
}
function setBanner(): void {
  const safeScore = (value: number): string => String(Number.isFinite(value) ? Math.max(0, Math.min(99, Math.trunc(value))) : 0).padStart(2, '0');
  score.innerHTML = `${safeScore(view.scoreL)} <b>:</b> ${safeScore(view.scoreR)}`;
  if (!isConnected) banner.textContent = t(lang, 'disconnected');
  else if (view.phase === 'waiting') banner.textContent = t(lang, 'waitStart');
  else if (view.phase === 'countdown') banner.textContent = String(Math.max(1, Math.ceil(view.countdown)));
  else if (view.phase === 'gameover') banner.textContent = t(lang, view.winner === 'left' ? 'hostWins' : 'guestWins');
  else banner.textContent = '';
  replayBtn.classList.toggle('hidden', !(role === 'host' && view.phase === 'gameover' && isConnected));
}
function ensureRenderer(): void {
  if (renderer) return;
  renderer = new DomPong(stage);
  input = new PaddleInput(board);
  input.changed = y => {
    if (!isConnected) return;
    if (role === 'host') {
      game.setPaddle('left', y);
    } else if (role === 'guest') {
      guestY = clamp(y, FIELD.margin + FIELD.paddleHeight / 2, FIELD.height - FIELD.margin - FIELD.paddleHeight / 2);
      view.rightY = guestY;
      sendGuestInput();
    }
  };
}
function sendGuestInput(): void {
  if (role !== 'guest') return;
  const due = NETWORK.inputMs - (performance.now() - lastInput);
  if (due <= 0) {
    clearTimeout(inputTimer);
    inputTimer = undefined;
    lastInput = performance.now();
    transport?.send({ type: 'input', y: guestY });
  } else if (!inputTimer) {
    inputTimer = setTimeout(() => {
      inputTimer = undefined;
      lastInput = performance.now();
      transport?.send({ type: 'input', y: guestY });
    }, due);
  }
}
function showPlay(): void {
  inMatch = true;
  controlHelp.textContent = t(lang, role === 'host' ? 'hostControl' : 'guestControl');
  only('game');
  view = role === 'host' ? game.snapshot() : view;
  setBanner();
  startLoop();
}
function startLoop(): void {
  if (raf || document.hidden || !inMatch) return;
  lastFrame = performance.now();
  raf = requestAnimationFrame(loop);
}
function loop(now: number): void {
  raf = 0;
  if (!inMatch || document.hidden) return;
  if (now - lastFrame >= 1000 / 30) {
    const dt = Math.min(.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (role === 'host' && isConnected) {
      game.step(dt);
      view = game.snapshot();
      if (now - lastSend >= NETWORK.snapshotMs || view.phase !== 'playing') {
        transport?.send(view);
        lastSend = now;
      }
    }
    renderer?.draw(view);
    setBanner();
  }
  raf = requestAnimationFrame(loop);
}
function renderRooms(rooms: AvailableRoom[]): void {
  available = rooms;
  availableRooms.replaceChildren();
  if (!rooms.length) {
    const info = document.createElement('p');
    info.className = 'lobby-empty';
    info.textContent = t(lang, 'noRoom');
    availableRooms.append(info);
  }
  for (const room of rooms) {
    const button = document.createElement('button');
    button.className = 'room-choice';
    button.type = 'button';
    button.textContent = `${room.label}  ↗`;
    button.disabled = guestRequesting;
    button.addEventListener('click', () => requestGuest(room.room, true));
    availableRooms.append(button);
  }
  if (rooms.length === 1 && !guestRequesting && rooms[0].room !== blockedRoom) {
    requestGuest(rooms[0].room, false);
  }
}
function requestGuest(room: string, manual: boolean): void {
  if (guestRequesting || !transport || role !== 'guest') return;
  guestRequesting = true;
  requestedRoom = room;
  if (manual) blockedRoom = null;
  for (const button of availableRooms.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true;
  status(t(lang, 'requesting'));
  transport.requestRoom(room);
}
function sessionStatus(next: Status, details?: string): void {
  const labels: Record<Status, CopyKey> = {
    connecting: 'negotiating', discovering: 'discovering', waiting: 'waiting',
    approval: 'approval', connected: 'connected', disconnected: 'disconnected', error: 'error'
  };
  const explanation = details && ['room_unavailable', 'room_taken', 'room_expired', 'guest:rejected', 'guest:timeout'].includes(details)
    ? t(lang, details as CopyKey) : details;
  status(`${t(lang, labels[next])}${explanation ? ' · ' + explanation : ''}`, next === 'error');
  if (next === 'connected') {
    isConnected = true;
    hostPair.classList.add('hidden'); guestPair.classList.add('hidden');
    if (role === 'host') {
      game.wait();
      transport?.send(game.snapshot());
      startBtn.classList.remove('hidden');
    } else {
      guestY = FIELD.height / 2;
      showPlay();
    }
  } else if (next === 'disconnected' || next === 'error' || next === 'waiting' || next === 'discovering') {
    isConnected = false;
    startBtn.classList.add('hidden');
    if (next === 'discovering' && role === 'guest') {
      guestRequesting = false;
      guestPair.classList.add('hidden');
      if (['guest:rejected', 'guest:timeout', 'room_unavailable'].includes(details ?? '')) blockedRoom = requestedRoom;
      requestedRoom = null;
      renderRooms(available);
    }
    if ((next === 'disconnected' || next === 'error') && role === 'guest') {
      guestRequesting = false;
      requestedRoom = null;
      lastRemoteSeq = 0;
      guestPair.classList.add('hidden');
    }
    if (next === 'disconnected' || next === 'error' || (next === 'waiting' && role === 'host' && inMatch)) {
      inMatch = false;
      if (role === 'host') game.wait();
      only('room');
    }
  }
}
function cleanup(): void {
  cancelAnimationFrame(raf); raf = 0;
  clearTimeout(inputTimer); inputTimer = undefined;
  transport?.close(); transport = null;
  renderer?.destroy(); renderer = null;
  input?.destroy(); input = null;
  game = new PongGame(); view = game.snapshot();
  role = null; inMatch = false; isConnected = false;
  lastRemoteSeq = 0; lastSend = 0; lastInput = 0;
  pendingRequest = null; guestRequesting = false;
  blockedRoom = null; requestedRoom = null; available = [];
  hostPair.classList.add('hidden'); guestPair.classList.add('hidden');
}
function restartSession(): void {
  if (deviceMode === 'unsupported') return;
  if (!navigator.onLine) { cleanup(); only('offline'); return; }
  void launch(deviceMode === 'glasses' ? 'guest' : 'host');
}
async function launch(nextRole: Role): Promise<void> {
  cleanup();
  role = nextRole;
  roomTitle.textContent = t(lang, nextRole === 'host' ? 'host' : 'guest');
  roomHint.textContent = t(lang, nextRole === 'host' ? 'linkHelp' : 'guestHelp');
  hostInvite.classList.toggle('hidden', nextRole !== 'host');
  guestInvite.classList.toggle('hidden', nextRole !== 'guest');
  startBtn.classList.add('hidden');
  hostLobbyName.textContent = '';
  roomTransport.textContent = '';
  gameTransport.textContent = '';
  only('room');
  if (nextRole === 'guest') renderRooms([]);
  const current = new PeerTransport(nextRole, nextRole === 'host' ? newRoom() : undefined);
  transport = current;
  current.onStatus = (state, details) => {
    if (transport === current) sessionStatus(state, details);
  };
  current.onModeChange = mode => { if (transport === current) setMode(mode); };
  current.onLobbyName = name => { if (transport === current) hostLobbyName.textContent = name; };
  current.onRooms = rooms => {
    if (transport === current && role === 'guest' && !isConnected) {
      renderRooms(rooms);
      if (!guestRequesting && rooms.length !== 1) status(t(lang, rooms.length ? 'chooseRoom' : 'discovering'));
    }
  };
  current.onPairRequest = request => {
    if (transport !== current) return;
    pendingRequest = request;
    hostPair.classList.toggle('hidden', !request);
    if (request) hostPairCode.textContent = request.confirmation;
  };
  current.onConfirmation = code => {
    if (transport !== current) return;
    guestPair.classList.toggle('hidden', !code);
    if (code) guestPairCode.textContent = code;
  };
  current.onMessage = packet => {
    if (role === 'host' && packet.type === 'input') game.setPaddle('right', packet.y);
    if (role === 'guest' && packet.type === 'state' && packet.seq > lastRemoteSeq) {
      if (view.phase === 'gameover' && packet.phase === 'countdown' &&
          packet.scoreL === 0 && packet.scoreR === 0) {
        guestY = FIELD.height / 2;
        input?.sync(guestY);
      }
      lastRemoteSeq = packet.seq;
      view = packet;
      view.rightY = guestY;
      setBanner();
    }
  };
  try { await current.connect(); }
  catch (error) { if (transport === current) sessionStatus('error', error instanceof Error ? error.message : String(error)); }
}

el<HTMLButtonElement>('offlineRetry').addEventListener('click', restartSession);
window.addEventListener('offline', () => {
  if (deviceMode !== 'unsupported') { cleanup(); only('offline'); }
});
window.addEventListener('online', () => {
  if (deviceMode !== 'unsupported' && navigator.onLine) restartSession();
});

el<HTMLButtonElement>('approveGuest').addEventListener('click', () => {
  if (pendingRequest) transport?.approve(pendingRequest.requestId);
});
el<HTMLButtonElement>('rejectGuest').addEventListener('click', () => {
  if (pendingRequest) transport?.reject(pendingRequest.requestId);
});
startBtn.addEventListener('click', () => {
  if (role !== 'host' || !isConnected || !game.start()) return;
  showPlay(); transport?.send(game.snapshot());
});
replayBtn.addEventListener('click', () => {
  if (role !== 'host' || !isConnected || !game.start()) return;
  transport?.send(game.snapshot());
});
el<HTMLButtonElement>('backFromRoom').addEventListener('click', restartSession);
el<HTMLButtonElement>('exitGame').addEventListener('click', restartSession);
window.addEventListener('resize', () => renderer?.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; if (input) input.enabled = false; }
  else { if (input) input.enabled = isConnected && inMatch; lastFrame = performance.now(); startLoop(); }
});
if (deviceMode === 'unsupported') {
  // Never create a PeerTransport or open a game session for non-Android browsers.
  only('intro');
} else {
  restartSession();
}
document.getElementById('bootStatus')?.remove();

// Installing on Android uses the standard PWA manifest. The Meta glasses app
// launcher uses /.well-known/meta-wearables-manifest.json separately.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(error => console.warn('[PWA] Service Worker unavailable:', error));
  });
}
