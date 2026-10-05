# Serveur de salles TokTok (Railway)

Relais WebSocket entre **TokTok Game Connector Live** (rôle `publisher`) et tes **jeux navigateur** (rôle
`game`). Il gère 20 salles (configurable), chacune protégée par un PIN.

## Variables d'environnement

| Variable     | Exemple                      | Rôle                                                |
| ------------ | ---------------------------- | --------------------------------------------------- |
| `ROOM_PINS`  | `1:483920,2:771045,3:209381` | PIN de chaque salle. Une salle sans PIN est fermée. |
| `ROOM_COUNT` | `20`                         | Nombre de salles                                    |
| `PORT`       | fourni par Railway           | Port HTTP/WebSocket                                 |

Utilise des PIN d'**au moins 6 caractères**. Après 5 PIN faux, une adresse IP est bloquée 5 minutes.

## Déploiement sur Railway

1. Crée un nouveau projet, puis un service relié à ce dépôt GitHub.
2. Dans _Settings → Root Directory_, indique `apps/rooms-server`. `railway.json` fournit les commandes de
   build et de démarrage, ainsi que le healthcheck `/health`.
3. Ajoute la variable `ROOM_PINS`, puis génère un domaine public.
4. Dans l'app, onglet **Intégrations**, ajoute **Serveur de salles** avec `wss://<ton-domaine>`, le numéro de
   salle et son PIN.

## Dans un jeu navigateur

```html
<script src="https://<ton-domaine>/toktok-room-client.js"></script>
<script>
  const room = TokTokRoom.connect({
    url: 'wss://<ton-domaine>',
    room: 3,
    pin: '209381',
    name: 'coin-pusher',
  });
  room.on('event', (e) => {
    if (e.type === 'gift') dropCoins(e.count * e.gift.diamonds);
    if (e.type === 'like') shakeBoard();
  });
  room.on('effect', (fx) => {
    if (fx.effect === 'bonus') startBonus(fx.params);
  });
  room.send({ score: 1200 }); // remonte dans le journal de l'app
</script>
```

Les événements (`gift`, `like`, `follow`, `chat`…) suivent le format `LiveEvent` décrit dans
`packages/shared/src/events.ts`.

## Développement

```bash
pnpm --filter @toktok/rooms-server build
ROOM_PINS="1:123456" PORT=8080 pnpm --filter @toktok/rooms-server start
```
