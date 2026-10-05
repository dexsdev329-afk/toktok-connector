# TokTok Game Connector Live

Application Windows (Electron) qui relie un **TikTok LIVE** et/ou un **live Kick** à des jeux PC, à des overlays et aux jeux de
communauté d'Anonyme Agency. Les cadeaux, likes, follows et messages des viewers déclenchent des effets en temps
réel : commandes Minecraft, touches clavier, alertes à l'écran…

> Statut : **phases 1 à 3 terminées**, application **100 % gratuite** (TikTok, Kick, Minecraft, overlays, thèmes, mises à jour) et espace web public. Voir [docs/PLAN.md](docs/PLAN.md) pour la feuille de route.

## Fonctionnalités

- **Connexion TikTok LIVE** via `tiktok-live-connector`. Reconnexion automatique (backoff exponentiel). La fin
  du live est détectée et l'app attend automatiquement le live suivant.
- **Connexion Kick** (lecture seule, sans compte) : chat, abonnements, abonnements offerts et cadeaux Kicks.
  TikTok et Kick peuvent être connectés **en même temps** (multistream) : une seule session, les mêmes actions.
- **Catalogue complet des cadeaux TikTok** (≈ 1 650 cadeaux, toutes régions, avec valeur et image) dès
  l'installation, sans attendre un premier live ; les cadeaux vus en live le complètent.
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
- **Overlays** pour TikTok LIVE Studio et OBS : alertes, top donateurs, objectif de likes, chat, spectateurs,
  derniers followers, roue de la fortune, minuteur subathon. Thèmes classique,
  néon et minimal ; couleurs, police et animations réglables ; aperçu en direct.
- **Journal en direct** de tous les événements et de toutes les actions exécutées.
- **API locale** (Stream Deck) : déclencher une action via HTTP avec un jeton.
- Interface **français / anglais** (i18next) : un test vérifie que les deux langues ont les mêmes clés et que
  chaque texte de l'interface, intégration, effet et préréglage est traduit. Restent en français : les noms que
  tu donnes toi-même et quelques messages techniques du journal.
- **Mises à jour automatiques** depuis GitHub Releases.

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

**Kick** : saisis le nom de ta chaîne (ou son URL `kick.com/...`) dans la ligne Kick. Les deux plateformes
peuvent tourner en même temps ; les spectateurs sont additionnés et les actions réagissent aux deux. Dans
l'éditeur d'une action, la section **Plateformes** permet de la limiter à TikTok ou à Kick.

Ce que Kick fournit à l'app (flux public en lecture seule, observé en octobre 2026) :

| Événement Kick                                            | Dans l'app                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Message du chat (emotes converties en texte)              | `chat` (commandes `!xxx`, mots-clés, TTS)                                        |
| Cadeau Kicks (Hell Yeah, Hype, Rage Quit…)                | `gift` : id `kick:<gift_id>`, valeur en Kicks (comptée comme des 💎)             |
| Abonnement (nouveau ou renouvelé, avec le nombre de mois) | `subscribe`                                                                      |
| Abonnements offerts                                       | `gift` « Abonnement offert » (`kick:gifted-sub`), `count` = nombre d'abonnements |
| Spectateurs (toutes les 30 s) / fin du live               | `viewerCount` / `disconnected`                                                   |

Limites : Kick ne diffuse pas publiquement les **follows** (aucun follow observé en 15 minutes sur 72 chaînes
en direct) et il n'y a pas de likes. Les abonnements offerts (`GiftedSubscriptionsEvent`) sont gérés mais n'ont
pas pu être observés pendant les tests. Le flux n'est pas documenté officiellement par Kick : s'il change, l'app ignore les messages
qu'elle ne comprend plus au lieu de planter.

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

### Jeux navigateur : serveur de salles

`apps/rooms-server` est un serveur de salles (20 salles avec PIN), prêt à être déployé sur Railway. L'app s'y
connecte via l'intégration **Serveur de salles** ; tes jeux web (Three.js…) le rejoignent avec un petit
script, `toktok-room-client.js`. Le déploiement est décrit dans [apps/rooms-server](apps/rooms-server).

### Jeux maison

Onglet **Jeux maison** : ajoute un jeu web, soit par son URL (Railway…), soit par un dossier local contenant
`index.html`. Le bouton **Ouvrir** lance le jeu dans une fenêtre isolée ; **URL pour OBS** donne un lien à
coller comme source navigateur. Le jeu inclut `toktok-game-client.js` (servi par l'app), reçoit tous les
événements du live, et peut recevoir des effets ciblés via l'intégration « Jeux maison ». C'est la même API
que celle du serveur de salles : un même jeu fonctionne en local et via Railway.

### Manette virtuelle (Windows)

L'intégration **Manette virtuelle** crée une manette Xbox 360 ou DualShock 4 grâce au pilote **ViGEmBus 1.22**.
Ce pilote est à installer soi-même : le projet est archivé et son installeur n'est pas redistribué. Les
séquences s'écrivent comme ceci : `press a 200`, `stick left 0 1 1500`, `trigger right 1 400`,
`dpad up 150`, `wait 300`. Les boutons sont toujours relâchés à la fin de la séquence.

### GTA V Chaos Mod (expérimental)

Pour GTA V en solo avec le [Chaos Mod](https://github.com/gta-chaos-mod/ChaosModV) (mod tiers, GPL-3.0, non
fourni) :

1. Dans le dossier de GTA V, crée le fichier vide `chaosmod/.enabledebugsocket` (cela active le WebSocket de
   debug du mod, en local uniquement : `ws://127.0.0.1:31819`).
2. Ajoute l'intégration **GTA V Chaos Mod** dans l'app. Elle attend le jeu et se connecte dès qu'il est lancé.
3. Effets : « Déclencher un effet Chaos » (liste remplie automatiquement depuis le mod) ou « Effet Chaos
   aléatoire ». Les effets désactivés dans la configuration du mod sont ignorés.

L'app n'utilise que les commandes `fetch_effects` et `trigger_effect`. La commande du mod qui exécute du Lua
arbitraire n'est volontairement pas exposée. Expérimental : non testé sur un vrai GTA V (testé contre un faux
serveur respectant le même format).

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

| Overlay            | Contenu                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Alertes            | Cadeaux (au-dessus d'un seuil), follows, partages, abonnements                                       |
| Top donateurs      | Classement de la session                                                                             |
| Objectif de likes  | Jauge, avec objectif qui augmente automatiquement                                                    |
| Chat               | Messages TikTok et Kick (badge de plateforme, MOD/SUB), commandes `!xxx` masquables, effacement auto |
| Spectateurs        | Nombre de spectateurs (TikTok + Kick additionnés), likes en option                                   |
| Derniers followers | Derniers follows et abonnements                                                                      |
| Roue               | Roue de la fortune : cases avec poids (chances) et **une action par case** lancée à l'arrêt          |
| Minuteur           | Compte à rebours type subathon : durée de départ, maximum, texte de fin                              |

La **roue** et le **minuteur** se pilotent depuis les actions grâce à l'intégration intégrée **Overlays
interactifs** :

- « Faire tourner la roue » : les tours s'enchaînent dans l'ordre ; le viewer qui a déclenché le tour est
  affiché et transmis à l'action de la case (variables `{username}`, `{count}`…).
- « Minuteur (subathon) » : ajouter / régler du temps, démarrer, pause, réinitialiser. Le temps peut être
  multiplié par le nombre de cadeaux ou leur valeur (ex. +10 s par 💎).

**Éditeur de thèmes** (fenêtre « Modifier » d'un overlay) : en plus du thème de base (classique, néon, minimal),
des couleurs, de la police et de l'animation, la section « Éditeur de thème (avancé) » règle le fond des cartes
(couleur + opacité), l'arrondi, la bordure, l'ombre (douce / lueur) et un contour de texte pour la lisibilité.
Cinq préréglages originaux sont fournis (TokTok, Arcade, Verre, Vert néon, Épuré). Un style peut être
enregistré comme thème réutilisable et appliqué à **tous les overlays** en un clic.

Des boutons manuels (🎡 Tourner, ⏯, ±1 min) sont aussi disponibles sur la page Overlays. Le paramètre
« Overlay » d'un effet accepte le nom de l'overlay ou `*` pour tous.

### 5. Stream Deck / API locale

```bash
curl -X POST -H "Authorization: Bearer <JETON>" http://127.0.0.1:21213/api/actions/<ID_ACTION>/trigger
```

Le jeton se trouve dans **Réglages**.

## Gratuit

TokTok Game Connector Live est **entièrement gratuit** : toutes les fonctions, intégrations et overlays sont
disponibles pour tout le monde, sans compte ni abonnement.

**Espace web** (accueil, catalogue des jeux avec guides, téléchargements) :
https://license-server-production-bb36.up.railway.app — servi par `apps/license-server` sur Railway (projet
`toktok-accounts`). Les illustrations des jeux se placent dans `apps/license-server/public/img/jeux/<id>.webp`
(générables avec `apps/license-server/scripts/generate-game-images.mjs`).

## Mises à jour automatiques

L'application installée vérifie les nouvelles versions sur les **GitHub Releases** du dépôt (au démarrage puis
toutes les 6 h, désactivable dans **Réglages → Mises à jour**). Rien n'est téléchargé sans clic : « Télécharger »,
puis « Redémarrer et installer » (sinon la mise à jour s'installe à la fermeture de l'app).

Publier une version :

1. Monter `version` dans `apps/desktop/package.json` (ex. `0.2.0`) et committer.
2. Pousser le tag correspondant (`git tag v0.2.0 && git push origin v0.2.0`), ou pousser un commit dont le
   message contient `[release]` (le tag est alors créé par le workflow).
3. Le workflow **Release** construit l'installateur et le publie avec `latest.yml` sur GitHub Releases.

L'installateur n'est pas signé (choix du projet) : Windows SmartScreen peut afficher un avertissement à la
première installation.

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
