# Déploiement GitHub Actions → alwaysdata

Le workflow se trouve dans `.github/workflows/deploy-alwaysdata.yml`. Il est déclenché par un `push` sur `main` ou depuis **Actions > Test, build and deploy NEON PONG to alwaysdata > Run workflow**.

## Chaîne CI/CD

1. `actions/checkout` récupère le dépôt.
2. Node.js 22 installe les dépendances (`npm ci` si `package-lock.json` existe, sinon `npm install`).
3. `npm run test:all` lance Vitest, les tests Node du serveur de signalisation et les tests d'intégration HTTPS/WSS.
4. `npm run build:deploy` : vérifie TypeScript, compile la webapp avec Vite dans `dist/`, copie le serveur Node.js natif dans `build/server/`, le frontend dans `build/dist/`, crée un manifeste limité aux dépendances de production, installe les dépendances dans `build/node_modules/` et lance un smoke test HTTP du serveur depuis `build/`.
5. `appleboy/scp-action@v1` copie **le contenu de** `build/` dans le répertoire du site alwaysdata, avec `strip_components: 1` pour ne pas créer un sous-répertoire `build/` supplémentaire.
6. Si et seulement si toutes les étapes précédentes ont réussi, la pipeline envoie `POST /v1/site/<ID>/restart/` à l'API REST alwaysdata.

Le dossier `build/` est un artefact déployable autonome :

```text
build/
├── dist/
│   ├── index.html
│   └── assets/...
├── server/
│   ├── index.mjs
│   └── ...
├── node_modules/  (dépendances de production uniquement, notamment ws)
├── package.json
└── package-lock.json  (généré lors de l'installation)
```

Le serveur n'a pas besoin d'être transpilé : il est écrit en `.mjs` natif pour Node 22, et il est inclus avec ses dépendances. Le répertoire de développement `.cert/`, les tests, le code TypeScript source et les dépendances de build ne sont pas envoyés.

## Secrets GitHub

Configure ces secrets dans **Settings > Secrets and variables > Actions** du dépôt ou de l'environnement `production` :

| Secret | Valeur attendue |
| --- | --- |
| `ALWAYSDATA_SSH_HOST` | Hôte SSH alwaysdata, par exemple `ssh-moncompte.alwaysdata.net` (à confirmer dans le panel) |
| `ALWAYSDATA_SSH_PORT` | Port SSH, généralement `22` |
| `ALWAYSDATA_SSH_USER` | Utilisateur SSH autorisé à écrire dans le dossier du site |
| `ALWAYSDATA_SSH_KEY` | Contenu complet de la clé privée SSH de déploiement (clé publique ajoutée au compte alwaysdata) |
| `ALWAYSDATA_SSH_FINGERPRINT` | Empreinte SHA256 vérifiée de la clé SSH **du serveur** (pas celle de la clé privée) |
| `ALWAYSDATA_DEPLOY_PATH` | Chemin absolu du répertoire de déploiement, par exemple `/home/moncompte/pong` |
| `ALWAYSDATA_API_KEY` | Token d'API créé dans le profil alwaysdata, autorisé à redémarrer le site |
| `ALWAYSDATA_ACCOUNT` | Nom du compte alwaysdata ciblé par le token API |
| `ALWAYSDATA_SITE_ID` | Identifiant numérique du site dans Web > Sites |

**Ne jamais mettre la clé SSH privée, la clé API ou les secrets TURN dans le dépôt.**

Si le compte alwaysdata impose une clé privée protégée par passphrase, ajoute un secret `ALWAYSDATA_SSH_PASSPHRASE` et la ligne `passphrase: ${{ secrets.ALWAYSDATA_SSH_PASSPHRASE }}` dans l'étape `appleboy/scp-action` du workflow.

La fingerprint peut être affichée avec `ssh-keyscan -p <PORT> <SSH_HOST> | ssh-keygen -lf -` ; **vérifie-la indépendamment** avant de l'accepter afin de ne pas faire confiance à une clé interceptée.

## Initialiser le site sur alwaysdata

Dans **Web > Sites**, configure un site **Node.js** (et non « Fichiers statiques »), avec Node 22 dans **Environnement > Node.js**.

- Commande Node.js : `node /home/moncompte/pong/server/index.mjs` — à adapter au secret `ALWAYSDATA_DEPLOY_PATH`.
- Le serveur écoute `HOST`, ou `IP` si `HOST` est absent, ainsi que `PORT`, fournis par l'environnement alwaysdata. Ne fige pas `PORT=3000` en production si alwaysdata t'impose un autre port.
- HTTPS est assuré par le reverse proxy d'alwaysdata ; le serveur Node utilise HTTP en interne. Les WebSockets seront `wss://` côté navigateur sous HTTPS.
- La racine du site est servie par le serveur Node (`dist/index.html`, génère le service worker PWA et les icônes Meta Wearables) ; ne pointe pas le site directement sur `dist/`, sinon `/ws` et les endpoints `/api/` ne fonctionneront pas.
- Si nécessaire, déclare `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` dans **l'environnement du site alwaysdata**, pas dans le dossier de build.
- Crée préalablement le répertoire de destination avec les permissions nécessaires pour l'utilisateur SSH (l'action ne doit pas écraser des fichiers importants en dehors de ce répertoire).

L'action SCP utilise `overwrite: true` et **`rm: false`** : elle remplace les fichiers portant le même nom, sans supprimer les fichiers historiques. Les anciens assets hachés pourront donc s'accumuler avec le temps ; effectue un nettoyage maîtrisé si nécessaire, en évitant tout répertoire partagé avec d'autres données.

## Commande de redémarrage vérifiée auprès d'alwaysdata

L'API alwaysdata documente la requête suivante :

```bash
curl --fail-with-body --silent --show-error \
  --request POST --basic \
  --user "${ALWAYSDATA_API_KEY} account=${ALWAYSDATA_ACCOUNT}:" \
  "https://api.alwaysdata.com/v1/site/${ALWAYSDATA_SITE_ID}/restart/"
```

Références officielles :

- https://help.alwaysdata.com/fr/docs/developpement/api/
- https://help.alwaysdata.com/fr/docs/developpement/api/exemples/
- https://help.alwaysdata.com/fr/docs/hebergement-web/langages/nodejs/configuration/
- https://help.alwaysdata.com/fr/docs/hebergement-web/sites/redemarrer-un-site/
- https://github.com/appleboy/scp-action

## Tests locaux et limites

```bash
npm install
npm run test:all
npm run build:deploy
cd build
npm start
```

Le redémarrage API confirme **l'acceptation** de la demande de redémarrage : il ne garantit pas à lui seul que le site est de nouveau sain. Contrôle `https://ton-domaine.example/api/health` et la connexion WebSocket `/ws` après le premier déploiement. GitHub Actions ne peut pas tester le serveur distant sans configuration de secrets et une destination alwaysdata réelle.

**Reproductibilité :** le projet historique ne contient pas de `package-lock.json`. Sur un poste avec accès npm, exécute `npm install --package-lock-only`, puis commite le lockfile ; le workflow utilisera alors `npm ci` automatiquement.

## Ressources PWA / Meta Wearables dans le déploiement

`npm run build:deploy` prépare également les fichiers :

```text
build/dist/
├── sw.js
├── manifest.webmanifest
├── offline.html
├── .well-known/meta-wearables-manifest.json
├── icons/pong-{192,512}.png
├── icons/pong-maskable-{192,512}.png
├── icons/meta-pong.svg
└── assets/ (JS/CSS Vite pré-cachés et versionnés)
```

Le script `finalize-pwa.mjs` génère le précache à partir des fichiers réellement présents dans `dist/`. Le smoke test du package demande `/sw.js`, `/manifest.webmanifest`, le manifest Meta et son icône, et contrôle leurs types MIME. Le serveur Node délivre `application/manifest+json` pour `.webmanifest` et `application/json` pour le manifest Meta ; ces fichiers et le service worker sont servis avec `Cache-Control: no-cache` pour permettre leur mise à jour.

**Attention au `scp-action` actuel :** il utilise `rm: false`. Les fichiers d'anciennes releases peuvent subsister côté hébergeur, notamment d'anciens assets hachés. Ils ne sont pas inclus dans le nouveau précache. Ne jamais effacer les fichiers déployés pendant un match actif sans stratégie de maintenance.

Après déploiement, reconnecter la webapp dans le menu Meta AI pour que la vignette soit lue depuis `/.well-known/meta-wearables-manifest.json`. Les lunettes doivent atteindre le domaine public en HTTPS avec un certificat valide.
