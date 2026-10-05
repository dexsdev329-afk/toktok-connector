# Plan du projet

## Décisions validées (octobre 2026)

| Sujet | Décision |
|---|---|
| Nom | **TokTok Game Connector Live** |
| Connecteur TikTok | **tiktok-live-connector** (AGPL-3.0, voir THIRD_PARTY_LICENSES.md), isolé derrière `LiveConnector` |
| Serveur de salles | Un **nouveau projet Railway** sera créé en phase 2 (protocole défini par nous) |
| Licence du code de l'app | Pas de décision particulière pour l'instant |
| Signature de code Windows | Pas pour l'instant (avertissement SmartScreen possible) |
| Priorité après la base | **Minecraft** (Java RCON, puis Bedrock) |

## Vérifications techniques (sources officielles)

- **tiktok-live-connector 2.5.0** : événements `chat`, `gift`, `like`, `follow`, `share`, `subNotify`,
  `roomUser`, `streamEnd`, `connected`, `disconnected`. Les combos concernent les cadeaux `giftType === 1` :
  `repeatCount` augmente, puis un dernier événement arrive avec `repeatEnd`. La signature passe par Euler
  Stream (`signApiKey` facultatif).
- **Kick** : l'API officielle (docs.kick.com) envoie ses événements uniquement par webhook. Le chat Pusher
  n'est pas documenté officiellement. → Phase 3 : Pusher en lecture, relais par le backend si nécessaire.
- **GTA V Chaos Mod** (GPL-3.0) : on ne peut déclencher un effet précis que via le Debug WebSocket
  `ws://127.0.0.1:31819`, et seulement si le fichier `chaosmod/.enabledebugsocket` existe. → Intégration
  « expérimentale ».
- **ViGEmBus** : projet archivé (fin de vie en 2023). Le driver n'est pas redistribué : l'utilisateur
  l'installe lui-même.
- **Minecraft Bedrock `/connect`** : protocole WebSocket JSON (`subscribe`, `commandRequest`), non documenté
  par Microsoft mais confirmé par le wiki Minecraft et plusieurs projets open source.
- **better-sqlite3 13** et **@jitsi/robotjs** : prebuilds N-API, donc aucune recompilation nécessaire pour
  Electron.

## Phases

### Phase 1 : MVP ✅
App Electron, connecteur TikTok, simulateur, moteur d'actions, Minecraft RCON, simulation clavier, 3 overlays
(alertes, top donateurs, objectif de likes), installeur NSIS, tests Vitest, CI.

### Phase 2
Minecraft Bedrock (`/connect`), manette virtuelle (ViGEmBus), bridge pour mods et exemple BepInEx,
webhook HTTP, serveur de salles Railway (nouveau projet), TTS (SAPI, API externe, filtre anti-insultes), sons,
module « Jeux maison ».

### Phase 3
Kick, overlays restants (chat, viewers, roue, timer, derniers followers), éditeur de thèmes, i18n complet,
mises à jour automatiques (electron-updater, GitHub Releases), Chaos Mod expérimental.

### Phase 4
Backend comptes, licences et Stripe (Express + PostgreSQL sur Railway). Les licences seront des tokens Ed25519
vérifiés hors ligne, avec un délai de grâce. Les feature flags sont déjà branchés : voir
`packages/core/src/entitlements.ts`.

## Schéma SQLite

Voir `packages/core/src/db/migrations.ts` (tables `settings`, `secrets`, `profiles`, `actions`,
`integrations`, `gift_catalog`, `overlays`, `sounds`, `live_sessions`, `viewer_stats`, `event_log`).
