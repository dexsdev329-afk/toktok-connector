# Licences des composants tiers

TokTok Game Connector Live est développé par Anonyme Agency. Tout le code de ce dépôt est original. Les
bibliothèques open source ci-dessous sont utilisées conformément à leur licence. Aucun logo, aucune image ni
aucun asset officiel de jeu n'est inclus. Les images de cadeaux TikTok ne sont pas distribuées avec l'app :
elles sont téléchargées depuis le CDN de TikTok au moment de l'utilisation et mises en cache localement sur la
machine de l'utilisateur.

Liste générée à partir de `pnpm licenses list --prod` puis vérifiée à la main (octobre 2026).
À mettre à jour à chaque ajout de dépendance.

## ⚠️ Composant sous licence copyleft

| Paquet                                                                              | Licence                               | Usage                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector) 2.5.0 | **AGPL-3.0-only** (« modified AGPL ») | Connexion au TikTok LIVE                    |
| [tiktok-live-proto](https://github.com/isaackogan/TikTok-Webcast-Protobuf) 0.2.4    | **AGPL-3.0-only**                     | Dépendance du précédent (décodage protobuf) |

L'AGPL-3.0 impose, lorsque l'application est distribuée, de fournir le code source correspondant de
l'œuvre combinée sous la même licence. Ce choix a été fait à la demande du propriétaire du projet. Le
connecteur est isolé derrière l'interface `LiveConnector` (`packages/core/src/connectors/tiktok/`) : on peut
le remplacer sans toucher au reste de l'application. Une vérification juridique est recommandée avant la
commercialisation (phase 4).

Note : la signature de la connexion passe par le serveur d'Euler Stream (service tiers). Une clé API
facultative peut être renseignée dans les réglages.

## Application de bureau (main process)

| Paquet                                                             | Licence                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| electron                                                           | MIT (Chromium et ses composants : voir `LICENSES.chromium.html` fourni avec l'app) |
| better-sqlite3                                                     | MIT (SQLite : domaine public)                                                      |
| @jitsi/robotjs                                                     | MIT                                                                                |
| rcon-client                                                        | MIT                                                                                |
| ws                                                                 | MIT                                                                                |
| zod                                                                | MIT                                                                                |
| tiktok-live-api-sdk (Euler Stream)                                 | MIT                                                                                |
| @bufbuild/protobuf                                                 | Apache-2.0 AND BSD-3-Clause                                                        |
| got et ses dépendances (cacheable-request, keyv, http2-wrapper, …) | MIT                                                                                |
| axios, follow-redirects, form-data, https-proxy-agent              | MIT                                                                                |
| typed-emitter                                                      | MIT                                                                                |
| rxjs                                                               | Apache-2.0                                                                         |
| tslib                                                              | 0BSD                                                                               |
| http-cache-semantics                                               | BSD-2-Clause                                                                       |
| type-fest                                                          | MIT OR CC0-1.0                                                                     |
| node-addon-api, node-gyp-build                                     | MIT                                                                                |
| obscenity (filtre anti-insultes anglais)                           | MIT                                                                                |

## Données

| Ressource                                                                                                                                                 | Licence   | Usage                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| [List of Dirty, Naughty, Obscene, and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) — liste `fr` | CC-BY-4.0 | Filtre anti-insultes de la synthèse vocale (`packages/core/src/extras/wordlist-fr.ts`, non modifiée) |

## Interface (renderer) et overlays

| Paquet                      | Licence |
| --------------------------- | ------- |
| react, react-dom, scheduler | MIT     |
| i18next, react-i18next      | MIT     |
| zustand                     | MIT     |
| tailwindcss (CSS généré)    | MIT     |

## Outils de développement (non distribués)

electron-vite, electron-builder, vite, @vitejs/plugin-react, typescript, vitest, eslint, typescript-eslint,
prettier : MIT ou Apache-2.0.

## Exemples et ressources prévus (phases suivantes)

| Ressource                              | Licence      | Statut                                                               |
| -------------------------------------- | ------------ | -------------------------------------------------------------------- |
| ViGEmBus (driver de manette virtuelle) | BSD-3-Clause | Non redistribué, installé par l'utilisateur (projet archivé en 2023) |
| BepInEx (exemple de mod Unity)         | LGPL-2.1     | Référencé, non inclus                                                |

Le texte complet de chaque licence se trouve dans le dossier `node_modules/<paquet>/` correspondant et dans le
dépôt de chaque projet.
