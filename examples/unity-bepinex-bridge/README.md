# Exemple : mod BepInEx (Unity) ↔ TokTok Game Connector Live

Plugin BepInEx 5 minimal qui se connecte au **bridge de mods** de l'app ([protocole](../../docs/bridge-protocol.md)).
Il déclare deux effets :

| Effet | Paramètres | Ce que fait le jeu |
|---|---|---|
| `spawn_cube` | `count` (1–20) | fait tomber des cubes devant la caméra |
| `show_message` | `text` | écrit un message dans le log BepInEx |

## Utilisation

1. Dans l'app, onglet **Intégrations**, ajoute **Bridge mods (WebSocket)**. Laisse le jeton vide, il sera
   généré automatiquement, puis copie-le.
2. Compile le plugin : `dotnet build -c Release`. Cette commande nécessite le SDK .NET ; les références
   BepInEx et Unity viennent du flux NuGet de BepInEx.
3. Copie `bin/Release/netstandard2.1/TokTokBridge.dll` dans `<jeu>/BepInEx/plugins/`.
4. Lance le jeu une fois, puis renseigne le jeton dans `BepInEx/config/com.anonymeagency.toktokbridge.cfg`.
5. Dans l'onglet **Actions**, les effets « Démo Unity — … » apparaissent dès que le jeu est connecté.

Adapte la version de `UnityEngine.Modules` à celle de ton jeu. Pour un jeu en IL2CPP, utilise BepInEx 6 ou
MelonLoader : la logique WebSocket reste la même.

## Points importants

- Le réseau tourne sur un thread séparé. Les effets sont mis en file d'attente, puis exécutés dans `Update()`
  sur le thread principal de Unity.
- Le plugin se reconnecte toutes les 3 secondes si l'app n'est pas lancée.
- Chaque effet reçoit une réponse `result` (`ok` ou `error`) : c'est ce qui permet à l'app de remplir son
  journal.
