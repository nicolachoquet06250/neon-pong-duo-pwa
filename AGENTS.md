# NEON PONG // DUO — Instructions for agents

Maintain a **single webapp with two roles** (phone host, Meta Ray-Ban Display guest). Do not introduce a native APK or two separate frontend applications. On app startup, `detectDeviceMode()` uses User-Agent: reject non-Android (render branded PC unsupported screen with no network session), detect `Android` + `Greatwhite Build/` as guest, other Android as host. Launch the role automatically without buttons; restarting stays in the detected role. This is a field-observed marker, not a guaranteed Meta device identity.

- Anonymous **WebSocket lobby** discovers waiting sessions on the same server. When one room is available the guest requests it automatically; for multiple rooms, show labels on **both devices** so users can select the correct one. Never claim Bluetooth paired-device discovery: webapps have no documented API for it.
- Host explicitly approves requests after seeing the same four-digit comparison code on both displays. Codes are UX confirmation, not cryptographic device authentication. Avoid exposing this unauthenticated anonymous lobby publicly without additional access controls.
- **WebSocket relay works immediately after approval**, including browsers with no `RTCPeerConnection` at all. Upgrade automatically to **RTCDataChannel** when both peers support it. On RTC failure, stay/play on WebSocket. Never reset the game due to a transport upgrade/downgrade.
- The phone is the **sole authority** for score, collisions, countdown, and winner; guest sends only right-paddle input. Server relays only validated `state` packets from host and `input` packets from guest, besides SDP/ICE. Limit payload/rate and validate Origin. Preserve the 1:1 pairing, short-lived rooms, and pending-request expiry.
- Keep Meta webapp metadata, 600x600 layout support, true black display background, low-resource HTML/CSS DOM sprite rendering and Neural Band pinch drag opt-in via initial `touch-action: none` CSS. No raw EMG or undocumented volume gesture API. Keep keyboard fallback.
- Keep engine pure TypeScript, render separate, input separate, network separate. Use HTTPS/WSS for physical devices. ICE/TURN optional because WebSocket relaying is a supported fallback. Production reverse proxy must forward WebSocket upgrades.
- Preserve French/English translations and tests. Install dependencies with `npm install`, then run `npm test` (Vitest handles `.test.ts`), `npm run test:signaling` (Node-native `.mjs`, no TypeScript imports), `npm run typecheck`, and `npm run build`. `npm run test:all` covers unit + integration; `npm run test:node` is an alias for the Node-native signaling integration test. Do not use experimental Node type-stripping flags to execute unit tests. Never claim real-glasses hardware verification without an actual test.

## Développement HTTPS

`npm run dev` démarre un unique serveur HTTPS (Vite/HMR et WSS sur le même port). `server/dev-tls.mjs` crée un certificat local sous `.cert/` ignoré par Git. Le serveur écoute par défaut sur `0.0.0.0` et affiche les URL LAN calculées par `server/local-network.mjs`; le certificat couvre les adresses IPv4 LAN détectées, mais reste auto-signé et non approuvé par les téléphones. Le serveur de production reste HTTP pour un proxy TLS externe. `npm run test:https` vérifie ce chemin quand les dépendances npm sont installées.

## Diagnostic lunettes (v1.1.5)
- Ne pas assimiler une page entièrement invisible à un échec Three.js ; le HTML d'accueil doit déjà s'afficher avant le rendu du jeu.
- Page serveur `/diagnostic` ou `/?diagnostic=1`, sans dépendance Vite ni Three.js. Le bandeau `bootStatus` de la page normale disparaît en fin de démarrage.
- En cas de certificat auto-signé non accepté ou de réseau local inaccessible, tester `npm run glasses` puis `cloudflared tunnel --url http://127.0.0.1:3000` : utiliser la même URL HTTPS publique temporaire côté téléphone et lunettes.

## Mobile layout (v1.1.7)
Phone UI may vertically scroll on short screens; `html[data-device-mode="phone"]` scopes compact phone-specific styles. Keep `.board` and `#stage` at `touch-action:none` for swipe-based paddle movement. Do not apply this scrolling override to glasses. User-Agent still selects the correct role but is not displayed in the standard app UI. The `/diagnostic` endpoint is available for support.

## Renderer (v1.1.8)
The scoreboard may remain functional when graphics silently fail. Paddles, ball, trails and court are now DOM sprites in `src/index.html` and `src/render/domPong.ts` (not WebGL). Preserve this readable, CSS-percentage-based 800x480 field. Do not reintroduce a mandatory WebGL canvas without a visible DOM fallback on *both* supported devices.

## Déploiement alwaysdata (v1.1.9)

- Workflow : `.github/workflows/deploy-alwaysdata.yml` ; consulte `docs/deploiement-alwaysdata.md`.
- Ordre obligatoire : tests complets → `npm run build:deploy` → SCP du **contenu** de `build/` → API REST POST de redémarrage du site.
- `build/` contient le frontend compilé, le serveur Node `.mjs` et `node_modules` production ; il ne doit jamais contenir des secrets, les certificats locaux ou les dépendances de développement.
- Le serveur écoute `HOST` ou `IP` selon alwaysdata, et `PORT` fourni par alwaysdata.


## v1.2.0 PWA / Meta Wearables

- Android PWA manifest: `public/manifest.webmanifest`, images standards et maskable dans `public/icons/`.
- Icône du lanceur lunettes: `public/.well-known/meta-wearables-manifest.json` et `public/icons/meta-pong.svg`; garder les URLs relatives conformes aux règles Meta.
- Service worker: `public/sw.js`; `scripts/finalize-pwa.mjs` injecte version et assets précachés APRÈS compilation Vite. Ne jamais précacher `/api/`, `/ws` ni `/diagnostic`.
- Offline: écran `#offlineScreen`; le jeu à deux nécessite toujours le réseau. En mode dev, ne pas enregistrer le SW (HMR).
- Build/deploy alwaysdata: `npm run build:deploy` continue à inclure `dist/` et `server/`. Tester les MIME et URL de manifest avant release.
