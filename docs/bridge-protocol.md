# Protocole du bridge de mods (v1)

Ce protocole permet à n'importe quel mod de jeu (BepInEx/MelonLoader pour Unity, script Lua, programme
externe…) de recevoir des effets déclenchés par le live.

- **Transport** : WebSocket, `ws://127.0.0.1:<port>`. Le port par défaut est `21214` ; il se règle dans
  l'intégration « Bridge mods ».
- **Format** : un objet JSON par trame texte (UTF-8), 256 Kio maximum.
- **Sécurité** : le serveur n'écoute que sur `127.0.0.1`. Toute connexion qui envoie un en-tête `Origin`
  (c'est le cas des navigateurs) est refusée. Le mod doit s'authentifier avec un **jeton** dans les 5 secondes.

Les schémas de référence se trouvent dans `packages/integrations/src/mod-bridge/protocol.ts` (zod).

## Déroulé

```
mod  → app   hello      (jeton + effets proposés)
app  → mod   welcome
app  → mod   effect     (à chaque action qui le déclenche)
mod  → app   result     (ok / error / busy, sous 5 s)
mod  → app   subscribe  (facultatif : recevoir les événements du live)
app  → mod   event
mod  → app   ping       → app → mod pong
```

## Messages du mod vers l'app

### `hello` (premier message, obligatoire)

```json
{
  "type": "hello",
  "protocol": 1,
  "token": "<jeton copié depuis l'app>",
  "mod": { "id": "my-unity-mod", "name": "Mon mod", "version": "1.0.0" },
  "effects": [
    {
      "id": "spawn_enemy",
      "name": "Faire apparaître un ennemi",
      "description": "Apparaît devant le joueur",
      "params": {
        "count": { "type": "int", "label": "Nombre", "default": 1, "min": 1, "max": 20 },
        "boss": { "type": "bool", "label": "Boss", "default": false }
      }
    }
  ]
}
```

- `mod.id` et les `id` d'effets : caractères `[A-Za-z0-9_.-]`, 64 au maximum.
- Types de paramètres : `string`, `int`, `number`, `bool`.
- Les effets déclarés apparaissent automatiquement dans l'éditeur d'actions, sous le nom
  « Mon mod — Faire apparaître un ennemi ».
- Un mod qui se reconnecte avec le même `mod.id` remplace sa session précédente.
- Si le jeton est mauvais, le serveur envoie `{"type":"error"}` puis ferme la connexion avec le code `4003`.

### `result` (réponse à chaque `effect`)

```json
{ "type": "result", "id": "<id reçu dans effect>", "status": "ok" }
{ "type": "result", "id": "…", "status": "busy" }
{ "type": "result", "id": "…", "status": "error", "message": "pas de joueur" }
```

Sans réponse dans les 5 secondes, l'effet est considéré comme en échec et le journal de l'app l'indique.

### `subscribe`

```json
{ "type": "subscribe", "events": ["gift", "chat", "follow"] }
```

Événements disponibles : `gift`, `like`, `follow`, `share`, `chat`, `subscribe`, `viewerCount`.

### `ping`

```json
{ "type": "ping" }
```

## Messages de l'app vers le mod

### `welcome`

```json
{ "type": "welcome", "protocol": 1, "sessionId": "…" }
```

### `effect`

```json
{
  "type": "effect",
  "id": "8c1d…",
  "effect": "spawn_enemy",
  "params": { "count": 3, "boss": false },
  "context": {
    "username": "luna",
    "displayName": "Luna",
    "giftName": "Rose",
    "giftId": "5655",
    "count": 3,
    "diamonds": 3,
    "message": "",
    "total": 0,
    "platform": "tiktok"
  }
}
```

Les paramètres texte peuvent contenir des variables (`{username}`, `{count}`…). Elles sont remplacées avant
l'envoi.

### `event` (si le mod s'est abonné)

```json
{ "type": "event", "event": { "type": "gift", "user": { "username": "luna", … }, "gift": { … }, "count": 3, … } }
```

Le format est celui des `LiveEvent` normalisés (`packages/shared/src/events.ts`).

### `error` / `pong`

```json
{ "type": "error", "message": "message invalide" }
{ "type": "pong" }
```

## Conseils pour les mods

- Exécute les effets sur le **thread principal** du jeu (file d'attente remplie depuis le thread réseau).
- Réponds `busy` plutôt que d'ignorer un effet que tu ne peux pas jouer tout de suite.
- Reconnecte-toi automatiquement (toutes les 2 à 5 s) si l'app n'est pas encore lancée.

Exemple complet : [`examples/unity-bepinex-bridge`](../examples/unity-bepinex-bridge).
