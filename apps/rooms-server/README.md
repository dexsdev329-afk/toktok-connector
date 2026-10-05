# Serveur de salles TokTok (Railway)

Relais WebSocket entre **TokTok Game Connector Live** (rôle `publisher`) et tes **jeux navigateur** (rôle
`game`). Il gère 20 salles (le nombre est configurable), chacune protégée par un PIN.

## PIN des salles

- Toutes les salles démarrent avec le PIN **`0000`** (`ROOM_DEFAULT_PIN`).
- Une fois connectée à sa salle, **l'app peut changer le PIN** : onglet Intégrations, bouton
  « 🔑 Changer le PIN ». Les jeux, eux, ne peuvent pas. Le nouveau PIN est enregistré dans
  `DATA_DIR/pins.json` (un volume Railway) et survit aux redémarrages.
- ⚠️ Tant qu'une salle garde `0000`, toute personne qui connaît l'adresse du serveur peut y entrer : change
  le PIN de tes salles dès la première connexion.
- PIN oublié : `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://<domaine>/admin/reset-pin?room=3"`
  remet la salle à `0000`.
- Après 5 PIN faux, une adresse IP est bloquée pendant 5 minutes.

## Variables d'environnement

| Variable           | Exemple                 | Rôle                                                  |
| ------------------ | ----------------------- | ----------------------------------------------------- |
| `ROOM_DEFAULT_PIN` | `0000`                  | PIN de départ de chaque salle                         |
| `ROOM_COUNT`       | `20`                    | Nombre de salles                                      |
| `DATA_DIR`         | `/data`                 | Dossier (volume) où sont enregistrés les PIN modifiés |
| `ADMIN_TOKEN`      | longue chaîne aléatoire | Autorise la remise à zéro d'un PIN                    |
| `ROOM_PINS`        | `1:483920`              | Facultatif : PIN imposé pour certaines salles         |
| `PORT`             | fourni par Railway      | Port HTTP/WebSocket                                   |

## Déploiement sur Railway

1. Crée un nouveau projet, puis un service relié à ce dépôt GitHub.
2. Dans _Settings_, règle : Root Directory `apps/rooms-server`, Build `npm install --include=dev && npm run build`,
   Start `npm start`, Healthcheck `/health`. Ces réglages sont déjà appliqués sur le projet `toktok-rooms`.
3. Ajoute un volume monté sur `/data`, les variables `DATA_DIR=/data` et `ADMIN_TOKEN`, puis génère un
   domaine public.
4. Dans l'app, onglet **Intégrations**, ajoute **Serveur de salles** avec `wss://<ton-domaine>`, le numéro de
   salle et le PIN `0000`, puis change le PIN.

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
DATA_DIR=./data PORT=8080 pnpm --filter @toktok/rooms-server start
```
