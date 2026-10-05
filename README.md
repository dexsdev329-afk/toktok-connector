# TokTok Game Connector Live

Application Windows (Electron) qui relie un **TikTok LIVE** à des jeux PC, à des overlays et aux jeux de
communauté d'Anonyme Agency. Les cadeaux, likes, follows et messages des viewers déclenchent des effets en temps
réel : commandes Minecraft, touches clavier, alertes à l'écran…

> Statut : **phase 1 (MVP)**. Voir [docs/PLAN.md](docs/PLAN.md) pour la feuille de route.

## Fonctionnalités (phase 1)

- **Connexion TikTok LIVE** via `tiktok-live-connector`. Reconnexion automatique (backoff exponentiel). La fin
  du live est détectée et l'app attend automatiquement le live suivant.
- **Simulateur** pour tout tester sans être en live : cadeaux avec combos, likes, follows, chat, pluie
  d'événements.
- **Moteur d'actions** : déclencheur → liste d'effets. Options disponibles : cooldown global et par viewer,
  priorités, file d'attente avec limitation de débit, politique « empiler / ignorer si occupé », multiplicateur
  par quantité, filtre par rôle (modérateurs, abonnés, followers) et liste noire.
- **Combos de cadeaux** : comptés une seule fois à la fin du combo, ou à chaque répétition (réglage).
- **Profils** d'actions par jeu, avec export et import en JSON.
- **Intégrations** :
  - **Minecraft Java (RCON)** : commandes avec variables et une vingtaine de préréglages (mobs, TNT, effets
    de potion, météo, titres, objets).
  - **Clavier & souris** : un petit langage de script (`tap`, `hold`, `wait`, `type`, `click`, `move`…).
- **Overlays** pour TikTok LIVE Studio et OBS : alertes, top donateurs, objectif de likes. Thèmes classique,
  néon et minimal ; couleurs, police et animations réglables ; aperçu en direct.
- **Journal en direct** de tous les événements et de toutes les actions exécutées.
- **API locale** (Stream Deck) : déclencher une action via HTTP avec un jeton.
- Interface **français / anglais** (i18next).

## Démarrage rapide (développement)

Prérequis : Node.js ≥ 22 et pnpm 10.

```bash
pnpm install
pnpm dev          # compile les overlays puis lance l'app en mode développement
```

| Commande         | Rôle                                              |
| ---------------- | ------------------------------------------------- |
| `pnpm test`      | Tests unitaires (Vitest)                          |
| `pnpm typecheck` | Vérification TypeScript (strict)                  |
| `pnpm lint`      | ESLint                                            |
| `pnpm build`     | Compile les overlays et l'app                     |
| `pnpm dist:win`  | Installeur Windows NSIS (`apps/desktop/release/`) |

L'installeur Windows est aussi produit par la CI GitHub Actions (artefact `windows-installer`).

## Architecture

```
apps/
  desktop/       Electron : main process (AppCore, IPC, natif) + interface React/Tailwind
  overlays/      Pages d'overlay (React), servies par le serveur local
packages/
  shared/        Types et schémas zod : événements normalisés, actions, overlays, templates
  core/          Base SQLite, event bus, moteur d'actions, connecteurs, cadeaux, serveur local
  integrations/  SDK d'intégration + Minecraft RCON + clavier/souris
docs/            Plan et documentation
```

Le flux des données :

`Connecteur (TikTok / simulateur)` → `EventBus` → `ActionEngine` → `IntegrationManager` → jeu

En parallèle, chaque événement alimente les statistiques, les overlays et le journal.

## Utilisation

### 1. Se connecter

Dans le **Tableau de bord**, saisis ton pseudo TikTok puis clique sur **Se connecter**. Si tu n'es pas en
live, l'app attend et se connecte automatiquement dès que le live démarre.

### 2. Minecraft

**Le plus rapide** : ajoute une intégration Minecraft (Java ou Bedrock), puis dans l'onglet **Actions**
clique sur **🧱 Pack Minecraft**. Ça crée un profil prêt à l'emploi : zombies nommés pour les petits cadeaux
(1–9 💎), creeper (10–98 💎), pluie de TNT (99–499 💎), boss (500 💎 et plus), titres pour les follows, vitesse
tous les 500 likes, commandes `!heal` et `!nuit` (`!nuit` réservée aux modos). Active le profil, c'est prêt.

Effets disponibles (sans écrire une seule commande) : faire apparaître un mob (nommé avec le pseudo du viewer,
optionnellement ×nombre de cadeaux), TNT et pluie de TNT, éclair, effet de potion, retirer les effets, donner
un objet, titre à l'écran, message dans le chat, météo, heure, supprimer les mobs autour. Le bouton ▶ à côté
d'un effet l'envoie tout de suite dans le jeu, pour tester.

#### Minecraft Java (RCON)

1. Dans `server.properties` :
   ```properties
   enable-rcon=true
   rcon.port=25575
   rcon.password=un_mot_de_passe_solide
   ```
2. Dans l'onglet **Intégrations**, ajoute **Minecraft Java (RCON)** : adresse, port, mot de passe, ton pseudo
   Minecraft (utilisé par `{player}`) et la version (1.21.5+ ou 1.13–1.21.4 : le format des noms de mobs
   a changé en 1.21.5).
3. **Tester la connexion** affiche les joueurs connectés.

#### Minecraft Bedrock (Windows 10/11, `/connect`)

1. Dans le monde : **triche activée**. Dans _Paramètres → Général_, désactive **« Websockets chiffrés
   obligatoires »** (le chiffrement n'est pas encore pris en charge).
2. Dans l'onglet **Intégrations**, ajoute **Minecraft Bedrock** (port 19135 par défaut).
3. Dans le chat du jeu, tape : `/connect localhost:19135`. Le message « TokTok Game Connector Live :
   connecté » s'affiche au-dessus de la barre d'inventaire.

Les commandes sont exécutées en tant que joueur qui a tapé `/connect`. Par défaut, la cible est donc `@s` (toi).

#### Commandes libres

L'effet « Commande Minecraft » accepte une commande par ligne avec des variables : `{player}` `{username}`
`{displayName}` `{giftName}` `{count}` `{diamonds}` `{message}` `{total}`. Elles sont échappées
automatiquement (guillemets, codes `§`). Les effets prêts à l'emploi, eux, n'acceptent que des mobs, effets
et objets d'une liste connue, et nettoient les pseudos : un viewer ne peut pas injecter de commande avec son
nom.

#### Tester sans Minecraft

```bash
node scripts/fake-rcon-server.mjs 25575 test   # affiche chaque commande reçue
```

Configure ensuite l'intégration RCON sur `127.0.0.1:25575` avec le mot de passe `test`, puis utilise le
simulateur du tableau de bord.

### 3. Clavier & souris

```
hold w 1500      # avancer 1,5 s
tap space        # sauter
tap ctrl+s       # combinaison de touches
wait 200
click left
moveby 400 0     # tourner la caméra
type gg !
```

Les touches restées enfoncées sont toujours relâchées à la fin d'une séquence, même si on l'annule. Certains
jeux DirectX ou anti-triche ignorent les entrées simulées.

### Bridge pour mods (Unity, Lua…)

Ajoute l'intégration **Bridge mods**. Elle ouvre un serveur local (`ws://127.0.0.1:21214`) protégé par un
jeton. Chaque mod qui s'y connecte déclare ses effets, qui apparaissent aussitôt dans l'éditeur d'actions.
Le protocole est décrit dans [docs/bridge-protocol.md](docs/bridge-protocol.md), et un exemple BepInEx en C#
se trouve dans [examples/unity-bepinex-bridge](examples/unity-bepinex-bridge).

### HTTP / Webhook

L'effet « Requête HTTP » appelle n'importe quelle URL (GET, POST…) à chaque action. Les variables placées
dans l'URL sont encodées, celles du corps JSON sont échappées. Si le corps est vide, l'app envoie tout le
contexte (`username`, `giftName`, `count`, `diamonds`…). C'est la façon la plus simple de brancher tes jeux
web hébergés sur Railway.

### Sons & synthèse vocale

Onglet **Sons & voix** :

- Importe des sons (mp3, wav, ogg), puis associe-en un à chaque action. Il y a un volume par son et un
  volume général.
- La synthèse vocale peut lire le chat (tout le monde, abonnés ou modos), les gros cadeaux, et une phrase
  propre à chaque action. Trois moteurs : voix Windows (SAPI), voix du système, ou ElevenLabs avec ta clé
  API.
- Le filtre anti-insultes (français et anglais, accents et leetspeak compris) remplace les mots par « bip »
  ou ignore le message. Tu peux ajouter tes propres mots.

### 4. Overlays

Dans l'onglet **Overlays**, copie l'URL d'un overlay et colle-la dans **TikTok LIVE Studio** ou **OBS**
(source navigateur, fond transparent). Le bouton « Nouveau lien » invalide l'ancienne URL.

### 5. Stream Deck / API locale

```bash
curl -X POST -H "Authorization: Bearer <JETON>" http://127.0.0.1:21213/api/actions/<ID_ACTION>/trigger
```

Le jeton se trouve dans **Réglages**.

## Sécurité

- Les secrets (mot de passe RCON, clé API) sont **chiffrés avec `safeStorage`** (DPAPI sous Windows) et ne
  sont jamais renvoyés en clair à l'interface.
- Le serveur local écoute **uniquement sur `127.0.0.1`**. L'en-tête `Host` est vérifié (protection contre le
  DNS rebinding), ainsi que l'`Origin` des WebSockets. Chaque overlay a un **jeton aléatoire** et l'API locale
  exige un jeton.
- Le renderer est isolé : `contextIsolation`, `sandbox`, CSP stricte, aucune API Node. Il n'existe qu'un seul
  canal IPC, et toutes les entrées sont validées par **zod** côté main process.
- Les images de cadeaux sont téléchargées uniquement depuis le CDN de TikTok (HTTPS, taille limitée).

## Données locales

Base SQLite `toktok.sqlite` dans `%APPDATA%/TokTok Game Connector Live/`, qui contient les profils, les
actions, les intégrations, le catalogue de cadeaux, les statistiques par live et le journal (purgé après
7 jours). Les images de cadeaux sont mises en cache dans `gift-images/`.

## Licences

Le code est original. Les licences des dépendances sont listées dans
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). ⚠️ `tiktok-live-connector` est sous **AGPL-3.0** :
lis la note correspondante avant toute distribution commerciale.
