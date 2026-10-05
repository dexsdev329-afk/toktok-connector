# Plan du projet

## Décisions validées (octobre 2026)

| Sujet                     | Décision                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Nom                       | **TokTok Game Connector Live**                                                                     |
| Connecteur TikTok         | **tiktok-live-connector** (AGPL-3.0, voir THIRD_PARTY_LICENSES.md), isolé derrière `LiveConnector` |
| Serveur de salles         | Un **nouveau projet Railway** sera créé en phase 2 (protocole défini par nous)                     |
| Licence du code de l'app  | Pas de décision particulière pour l'instant                                                        |
| Signature de code Windows | Pas pour l'instant (avertissement SmartScreen possible)                                            |
| Priorité après la base    | **Minecraft** (Java RCON, puis Bedrock)                                                            |

## Vérifications techniques (sources officielles)

- **tiktok-live-connector 2.5.0** : événements `chat`, `gift`, `like`, `follow`, `share`, `subNotify`,
  `roomUser`, `streamEnd`, `connected`, `disconnected`. Les combos concernent les cadeaux `giftType === 1` :
  `repeatCount` augmente, puis un dernier événement arrive avec `repeatEnd`. La signature passe par Euler
  Stream (`signApiKey` facultatif).
- **Kick** : l'API officielle (docs.kick.com) envoie ses événements uniquement par webhook (URL publique et
  application OAuth nécessaires). Le flux Pusher public utilisé par kick.com n'est pas documenté. Vérifié en
  octobre 2026 sur des lives réels : clé `32cbd69e4b950bf97679` (cluster `us2`), canaux `chatrooms.<id>.v2`
  (chat), `channel_<id>` (Kicks, abonnements) et `channel.<id>` (fin du live) ; catalogue des cadeaux sur
  `web.kick.com/api/v1/kicks/gifts`. Aucun follow observé. → Implémenté en lecture seule (phase 3).
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

### Focus Minecraft ✅ (avancé de la phase 2)

Effets structurés Java et Bedrock, intégration Bedrock `/connect`, pack Minecraft en un clic, test d'un
effet depuis l'éditeur, faux serveur RCON pour les tests. Reste à faire : websockets chiffrés Bedrock
(`enableencryption`, à valider sur un vrai client).

### Phase 2 ✅

Manette virtuelle (ViGEmBus), bridge pour mods et exemple BepInEx,
webhook HTTP, serveur de salles Railway (nouveau projet), TTS (SAPI, API externe, filtre anti-insultes), sons,
module « Jeux maison ».

### Phase 3 ✅

Kick (lecture seule, multistream avec TikTok), overlays restants (chat, spectateurs, roue, minuteur, derniers
followers), éditeur de thèmes, i18n complet (tests de complétude FR/EN), mises à jour automatiques
(electron-updater, GitHub Releases, workflow Release), Chaos Mod expérimental (WebSocket de debug, vérifié dans
les sources du mod, mai 2026).

### Phase 4 → abandonnée : tout est gratuit

Décision (octobre 2026) : pas d'abonnement Pro. Toutes les fonctions sont débloquées pour tous
(`packages/core/src/entitlements.ts`). Le serveur `apps/license-server` sert l'espace web public ; son API de
comptes / licences / Stripe, développée puis mise de côté, n'est plus utilisée par l'app ni par le site.

## Schéma SQLite

Voir `packages/core/src/db/migrations.ts` (tables `settings`, `secrets`, `profiles`, `actions`,
`integrations`, `gift_catalog`, `overlays`, `sounds`, `live_sessions`, `viewer_stats`, `event_log`).
