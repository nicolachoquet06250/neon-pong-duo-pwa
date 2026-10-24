# NEON PONG // DUO (v1.2.0)

## Installation PWA et icône Meta Ray-Ban Display (v1.2.0)

La même application comporte **deux manifests distincts** :

- `public/manifest.webmanifest` : installation de la **PWA Android** (mode `standalone`, icônes 192 / 512 PNG et variantes `maskable`). Sur Android Chrome, ouvrir l'adresse HTTPS de production, puis choisir **Installer l'application** dans le menu du navigateur.
- `public/.well-known/meta-wearables-manifest.json` : nom et icône dans le **menu d'applications des Meta Ray-Ban Display**. Ce manifest Version 1 utilise `appearance.theme_color` et une icône monochrome transparente dans `public/icons/meta-pong.svg`. L'icône des lunettes ne dépend **pas** des icônes PWA Android ni du favicon. La version déployée doit être accessible à `https://DOMAINE/.well-known/meta-wearables-manifest.json`, avec une réponse JSON, et l'icône à `https://DOMAINE/icons/meta-pong.svg`.

Après le déploiement, ajoute ou reconnecte la webapp avec **Meta AI > App Settings > Apps > Web Apps > Connect Web App**, en utilisant l'URL HTTPS de base (avec `/` final). Si l'ancienne icône reste affichée, reconnecte la webapp pour forcer une nouvelle lecture du manifest. Ce mécanisme est propre aux Web Apps Meta : le statut « installable PWA » d'Android n'est pas requis pour le menu des lunettes.

**Offline :** en production HTTPS, la webapp enregistre `/sw.js`. À la première visite connectée, le service worker installe en cache l'interface HTML, les scripts/styles Vite compilés, les manifests et les icônes. Après cette première visite et l'activation du worker, l'interface peut s'ouvrir hors ligne, et elle indique « Connexion requise » avec un bouton Réessayer et une reprise automatique au retour du réseau. **Les matchs à deux joueurs, les salons, WebSocket et WebRTC ne fonctionnent pas sans réseau** : ils ne sont jamais mis en cache. Si le navigateur des lunettes désactive ou purge le cache, le démarrage sans réseau peut échouer : à vérifier physiquement.

Le cache est versionné **automatiquement par hash du build complet** : le script `scripts/finalize-pwa.mjs`, exécuté à la fin de `npm run build`, génère une liste de précache contenant notamment les assets fingerprintés de Vite. L'activation d'une nouvelle version purge uniquement les anciens caches `neon-pong-shell-*`. Les requêtes `/api/*`, `/ws` et `/diagnostic` ne sont jamais interceptées. Le service worker n'est **pas enregistré en mode `npm run dev`**, afin de ne pas casser le hot reload et le diagnostic HTTPS/WSS ; pour valider le offline, exécuter `npm run build && npm start` avec HTTPS via un reverse proxy / domaine réel, ou `npm run glasses` si l'environnement le permet.

**Contrôles après déploiement :**

```text
https://DOMAINE/manifest.webmanifest
https://DOMAINE/sw.js
https://DOMAINE/.well-known/meta-wearables-manifest.json
https://DOMAINE/icons/meta-pong.svg
```

La documentation officielle Meta décrit le manifest Wearables et son emplacement `.well-known` : https://wearables.developer.meta.com/docs/develop/webapps/build/app-icons/ . Le fonctionnement offline est également décrit ici : https://wearables.developer.meta.com/docs/develop/webapps/build/storage-and-offline-support/ .

## Déploiement alwaysdata par GitHub Actions

Le workflow `.github/workflows/deploy-alwaysdata.yml` exécute `npm run test:all`, construit le client et prépare un package **client + serveur Node.js + dépendances runtime** dans `build/`, transfère ce répertoire par `appleboy/scp-action@v1`, puis redémarre le site via l'API REST alwaysdata.

Consulte **[la procédure complète et la liste des secrets GitHub](docs/deploiement-alwaysdata.md)** avant de lancer le pipeline. Le serveur Node.js doit être configuré avec le port/IP toujours fournis par alwaysdata. Aucun secret ne doit être commité.

Pour reproduire le build de production localement (avec réseau npm) : `npm run build:deploy`.


Une **seule webapp** pour **deux joueurs** : téléphone hôte et lunettes Meta Ray-Ban Display invitées. Jeu Pong rétro multijoueur, commandes tactiles sur téléphone et pincement-glissement via Meta Neural Band lorsque les Pointer Events sont fournis par le navigateur.

## Détection automatique du support (v1.1.8)

Au chargement de la **même URL** sur les deux appareils, le mode est sélectionné sans bouton ni écran de choix :

| User-Agent | Comportement |
| --- | --- |
| Ne contient pas `Android` | Écran « Jeu non disponible sur PC » avec le logo et l'identité visuelle de Pong ; aucune connexion au serveur multijoueur |
| Contient `Android` **et** `Greatwhite Build/` | **Lunettes (invité)** : recherche immédiatement une partie |
| Contient `Android` sans `Greatwhite Build/` | **Téléphone (hôte)** : crée immédiatement une partie |

Le marqueur `Greatwhite Build/` provient des mesures réalisées sur les lunettes ; sa présence dans le User-Agent n'est pas une garantie contractuelle de Meta et pourrait évoluer. La casse et les espaces séparant `Greatwhite` et `Build/` sont tolérés. Le User-Agent n’est plus affiché à l’écran ; la détection reste active en interne. Les navigateurs iOS sont également refusés puisque la règle imposée ici exige la chaîne `Android`.

**Parcours de jeu :**

1. Ouvrir l'URL HTTPS sur le **téléphone Android** : le mode hôte s'ouvre automatiquement et annonce une salle dans le hall (`ARCADE 001`, etc.).
2. Ouvrir cette même URL sur les **Meta Ray-Ban Display** : le mode lunettes s'ouvre automatiquement et recherche la salle. Si plusieurs parties sont en attente, sélectionner la bonne.
3. Les **mêmes quatre chiffres** apparaissent sur les lunettes et le téléphone. Le joueur sur téléphone vérifie et appuie sur **Autoriser**.
4. Le match est immédiatement utilisable par WebSocket. Une connexion WebRTC DataChannel est également tentée en arrière-plan ; son succès ou échec ne réinitialise pas le jeu.
5. Premier joueur à 7 points. Les boutons « Recommencer » réouvrent le hall dans le **même mode détecté**, sans choix manuel.

Pour tester avec un ordinateur malgré le blocage voulu du mode PC, utiliser un émulateur Android ou la fonction de substitution du User-Agent des DevTools Chrome (afin de simuler un téléphone Android ou un navigateur `Android ... Greatwhite Build/...`). Cela ne reproduit pas les capacités matérielles des lunettes.

**Important :** il s'agit d'une **découverte via un serveur WebSocket**, PAS d'une détection automatique du téléphone associé aux lunettes en Bluetooth, ni d'une liaison P2P spontanée sans signalisation. Les salles annoncées sont visibles par toute personne qui utilise la **même instance publique** du serveur : utilisez une instance privée ou ajout de comptes/authentification avant toute diffusion à grande échelle. La validation côté téléphone empêche l'entrée dans une partie sans accord, mais **le code affiché n'authentifie pas cryptographiquement l'appareil**. Il aide seulement à éviter les erreurs d'appairage.

## Affichage mobile (v1.1.8)

L’interface du **téléphone Android** a été compactée verticalement : en-tête, panneau d’appairage, score, informations de transport et pied de page occupent moins de place. Le terrain de jeu reste entièrement affiché au maximum de la place disponible, et ses gestes tactiles restent actifs (`touch-action: none` sur le terrain uniquement). Si un téléphone très petit ne peut pas afficher tout le panneau de connexion, **la page peut défiler verticalement**. Le mode lunettes (600 × 600) et l’écran PC restent indépendants des styles mobile. Le bandeau d’affichage du User-Agent a été retiré de l’application, tout en conservant la détection automatique `Greatwhite Build/` et la route `/diagnostic` pour les recherches de panne.


## Correctif rendu terrain (v1.1.8)

Le score avançait alors que les raquettes et la balle étaient absentes de l'écran.
Le score étant affiché dans le DOM indépendamment du rendu WebGL, le moteur de jeu pouvait continuer à tourner malgré un terrain invisible.
Le terrain utilise désormais des **éléments HTML positionnés en pourcentage** (barres cyan/rose, balle blanche et traînée, lignes du terrain) et des styles CSS, au lieu d'un canvas Three.js.
Le terrain est dessiné dès l'affichage du match, sans dépendance à une capacité WebGL. Il conserve le ratio 800×480, une taille minimale des barres/balle sur téléphone et les mêmes commandes au doigt / Neural Band.
Le moteur physique, le score, la détection automatique des appareils et le multijoueur ne changent pas.
Les sprites initiaux sont dans le HTML et sont donc visibles même avant le premier snapshot reçu.

## Installation et exécution

Node.js **22+** :

```bash
npm install
npm run dev
```

La commande lance **HTTPS + WSS sur le même port** et **écoute sur `0.0.0.0:3000` par défaut**. Cela signifie que l'application est accessible depuis le PC et les appareils du même réseau, sans passer d'argument à `npm run dev`.

Le terminal affiche les URL détectées, par exemple :

```text
Neon Pong dev listening on 0.0.0.0:3000
  Local:   https://localhost:3000
  Network: https://192.168.1.42:3000
```

Depuis le téléphone, **ouvrir l'URL `Network`** (en remplaçant l'IP par celle affichée chez toi) ; `0.0.0.0` est l'adresse d'écoute du serveur et **ne doit pas être saisie dans le navigateur**. Pour les tests, téléphone et PC doivent utiliser un réseau permettant les connexions locales (Wi-Fi sans isolation des clients), et le pare-feu du PC doit autoriser le port TCP 3000. Si Node tourne dans WSL2, le mode réseau et les règles Windows peuvent nécessiter une configuration de transfert du port ou le mode `mirrored`.

Le certificat local auto-signé est généré sous `.cert/`, réutilisé et **régénéré automatiquement si les adresses IP LAN changent**. Il contient `localhost`, les adresses loopback et les IPv4 LAN détectées pour éviter une erreur de nom de certificat. Cela **ne le rend pas approuvé** par Android ou les lunettes : le navigateur peut refuser la connexion tant que l'autorité de certification n'est pas installée et approuvée. Une URL HTTPS valide (avec certificat public reconnu) reste préférable pour les essais sur Meta Ray-Ban Display. Le hot reload Vite utilise WSS ; les connexions de jeu sont `wss://<hôte>/ws`.

Sur ordinateur, la page principale affiche volontairement « Jeu non disponible sur PC ». Pour simuler les deux appareils dans deux navigateurs desktop, substituer leurs User-Agents par des User-Agents Android (dont un avec `Greatwhite Build/`) ; le clic + glissement et les flèches haut/bas restent disponibles pour les tests.

**Certificat personnalisé ou nom DNS additionnel :** les IPs LAN sont désormais ajoutées automatiquement. `DEV_TLS_HOSTS=mon-pc.local` permet aussi d'inclure un nom DNS supplémentaire dans le certificat auto-signé (redémarrer après changement). Sur Windows (PowerShell) : `$env:DEV_TLS_HOSTS='mon-pc.local'; npm run dev`. Pour fournir un certificat local *déjà approuvé*, par exemple créé avec [mkcert](https://github.com/FiloSottile/mkcert), utiliser `DEV_TLS_KEY` et `DEV_TLS_CERT` (chemins relatifs au dépôt ou absolus). Attention : un certificat auto-signé n'est **pas automatiquement approuvé** par le téléphone ni par les lunettes ; pour ces dernières, utiliser idéalement un domaine HTTPS valide ou un tunnel HTTPS sécurisé (et WSS) accessible des deux appareils.

Pour les deux **appareils physiques**, déployer sur une même **URL HTTPS publique**. Les webapps Meta Ray-Ban Display exigent HTTPS et l'accès au navigateur intégré doit être activé via l'application Meta AI (mode développeur). Les deux webapps doivent accéder au même serveur Node, notamment à `/ws`.

### Production

```bash
npm install
npm run build
npm start
```

Docker :

```bash
docker build -t neon-pong-display .
docker run --rm -p 3000:3000 neon-pong-display
```

Prévoir un reverse proxy HTTPS (Caddy, nginx ou Traefik) avec transmission de l'Upgrade WebSocket sur `/ws`. Ce service **n'est pas compatible avec un hébergement uniquement statique**, car la découverte, les validations et le repli multijoueur nécessitent le serveur Node.

Le serveur conserve les salles en mémoire (redémarrage = salles perdues). Il faut **une seule instance de signalisation** derrière le domaine ; le déploiement multi-instance nécessite un état partagé/pub-sub, non inclus. Les connexions inactives et demandes de validation sont limitées dans le temps. Sur une instance publique, ajouter authentification, quotas IP et contrôle des origines autorisées avant de l'exposer largement.

### TURN facultatif pour le P2P

Les connexions WebRTC traversent plus facilement certains réseaux avec TURN, mais le jeu reste jouable sur WebSocket lorsque le DataChannel ne fonctionne pas :

```ini
TURN_URLS=turn:turn.example.org:3478,turns:turn.example.org:5349
TURN_USERNAME=user-ephemeral
TURN_CREDENTIAL=secret-ephemeral
```

Utiliser des identifiants TURN temporaires en production, et pas des secrets permanents partagés avec tous les navigateurs.

## Diagnostic affichage lunettes (écran vide)

Si l'application disparaît après son lancement dans le menu des Meta Ray-Ban Display (sans même afficher le User-Agent), **cela ne prouve pas un problème Three.js**. La page d'accueil contient du HTML et du texte statique. Commencer par tester le chargement HTTPS.

### 1 — Page de contrôle indépendante

En laissant `npm run dev` tourner, remplace temporairement l'URL de la Web App dans Meta AI par :

```text
https://ADRESSE_DU_PC:3000/diagnostic
```

La variante `https://ADRESSE_DU_PC:3000/?diagnostic=1` fonctionne également. Revenir ensuite à l'URL normale. Cette page **ne dépend ni de Vite, ni du moteur du jeu, ni des fichiers CSS/TS du jeu**. Elle doit afficher **« HTML : OK »** immédiatement, puis les états JavaScript, HTTPS API, WebSocket et le User-Agent. Elle teste aussi `/api/health` et `/ws` (sans rejoindre de session).

- **Rien, même pas « HTML : OK »** : la requête n'arrive pas correctement jusqu'à l'affichage HTML ; vérifier adresse, route réseau et confiance TLS. L'absence du message n'identifie pas à elle seule le certificat comme cause certaine.
- **HTML : OK, mais JavaScript non exécuté** : le document arrive, mais le script inline n'est pas exécuté ; vérifier les restrictions du navigateur.
- **HTML et JavaScript OK, mais API/WebSocket en échec** : examiner les règles HTTPS, WSS et réseau.
- **Tout est OK ici, mais la webapp principale reste invisible** : chercher une erreur de chargement des modules Vite, de CSS ou d'initialisation dans l'app.

En développement, le serveur journalise les requêtes d'entrée `GET /`, `GET /diagnostic`, `GET /main.ts`, `GET /@vite/client`, avec leurs codes HTTP. Si aucun accès n'apparaît lorsque les lunettes lancent l'app, inspecter d'abord la connexion réseau et le certificat. Dans la webapp normale, une bannière temporaire « HTML chargé » reste affichée si l'initialisation JavaScript échoue, puis disparaît lorsque l'interface démarre normalement.

### 2 — Solution recommandée : vraie URL HTTPS publique (test)

Le certificat auto-signé utilisé par `npm run dev` n'est pas automatiquement approuvé sur les lunettes. De plus, la connectivité locale du téléphone ne garantit pas que le navigateur des lunettes pourra joindre l'IP privée du PC. Pour isoler ces deux problèmes, tester temporairement avec un tunnel offrant un certificat public.

Terminal 1 (build et serveur HTTP local, **avec** le jeu et la signalisation WebSocket) :

```bash
npm run glasses
```

Terminal 2 (nécessite l'installation préalable de `cloudflared`) :

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Utiliser l'adresse aléatoire `https://....trycloudflare.com` affichée par `cloudflared` **sur le téléphone et dans Meta AI pour les lunettes**. Le navigateur externe utilise un certificat HTTPS public reconnu ; Cloudflare parle HTTP au serveur local, sans certificat auto-signé à valider côté lunettes. Le serveur de jeu et le chemin WebSocket `/ws` continuent à fonctionner derrière le tunnel. **Ne pas exposer ce tunnel au-delà d'un essai privé : n'importe qui possédant l'URL peut accéder au service**, dont le lobby de test est anonyme. Pour un usage durable, prévoir un vrai domaine HTTPS et un contrôle d'accès approprié.

Si cela fonctionne via le tunnel mais pas via `https://IP:3000`, le défaut est probablement situé dans l'accès à l'URL LAN / certificat. Ce contrôle ne remplace pas un test sur l'appareil.

## Répartition des responsabilités

| Élément | Comportement |
| --- | --- |
| Téléphone (hôte) | Crée une salle aléatoire interne, accepte le partenaire et simule la physique/score ; raquette gauche contrôlée au doigt |
| Lunettes (invité) | Découvre les salles, demande à rejoindre, affiche les chiffres de validation ; raquette droite par pincement-glissement ou flèches haut/bas |
| WebSocket | Découverte, validation, SDP/ICE, et transport des entrées/états de jeu en mode relais |
| WebRTC DataChannel | Transport préféré dès ouverture effective, sans nouveau bouton à presser |
| HTML/CSS | Rendu des raquettes, balle et terrain avec des éléments DOM, sans WebGL ni Canvas |

Rendu client à environ 30 images/s, simulation autoritaire hôte, snapshots à environ 20 Hz, input lunettes environ 30 Hz. La bascule du transport **ne redémarre pas le match**.

## Tests

Les tests unitaires sont désormais exclusivement en TypeScript et exécutés via Vitest. Aucun test `.mjs` n’importe directement un fichier `.ts`. Installer les dépendances (`npm install`) avant de lancer les commandes suivantes.

```bash
npm test               # tests unitaires TypeScript via Vitest (moteur + WebSocket/WebRTC simulés)
npm run test:signaling # test d'intégration Node.js pur en .mjs (serveur WebSocket réel)
npm run test:node      # intégration Node.js et détection d'interfaces réseau
npm run test:https      # test HTTPS/WSS en mode dev (avec Vite)
npm run test:all       # tests unitaires + intégration + HTTPS
npm run typecheck      # vérification TypeScript
npm run build          # typecheck et compilation Vite
```

**Matériel :** le navigateur des lunettes est basé sur Chromium et propose des Pointer Events dans les chemins d'entrée documentés, mais **WebRTC DataChannel n'est pas explicitement garanti** dans les sources Meta consultées : cela nécessite des tests sur vraies lunettes. D'où le repli WebSocket inclus. Le geste « molette du volume » n'est pas utilisé, aucune API publique générique documentée ne l'exposant à JavaScript. Le geste « pincement puis mouvement de la main » nécessite aussi une validation sur le matériel et le firmware cible.

## Arborescence

```text
server/index.mjs            # serveur HTTPS/WSS dev, HTTP prod, lobby et relais
server/dev-tls.mjs          # génération/caching du certificat auto-signé dev (IP LAN incluses)
server/local-network.mjs     # découverte des adresses IPv4 LAN pour certificat et console
server/diagnostics.mjs       # page HTML de contrôle sans dépendances CSS/JS du jeu
tests/diagnostics.test.mjs  # tests de la page de diagnostic
src/main.ts                 # orchestration des deux rôles, appairage, HUD
src/net/transport.ts        # négociation WebRTC, fallback WebSocket, changement de mode
src/core/engine.ts          # moteur Pong déterministe / physique autoritaire
src/input/paddleInput.ts    # toucher, Pointer Events Neural Band, flèches
src/render/domPong.ts       # raquettes et balle HTML/CSS, sans WebGL
src/i18n.ts                 # textes français et anglais
src/core/engine.test.ts    # tests unitaires Vitest du moteur
src/net/transport.test.ts  # tests unitaires Vitest du réseau, WebRTC et repli WebSocket
tests/signaling.integration.mjs # intégration Node.js du serveur, sans import TypeScript
tests/dev.https.integration.mjs # HTTPS/WSS + Vite HMR et vérification du certificat
tests/local-network.test.mjs # détection IP LAN avec Node natif
```

## Documentation

- https://wearables.developer.meta.com/docs/develop/webapps/
- https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- https://github.com/facebook/meta-wearables-webapp
