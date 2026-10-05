// Minimal BepInEx 5 plugin connecting a Unity game to TokTok Game Connector Live.
// Protocol: docs/bridge-protocol.md (v1). Original example code, MIT-style use allowed.
using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using BepInEx;
using BepInEx.Configuration;
using UnityEngine;

namespace TokTokBridge
{
    [BepInPlugin("com.anonymeagency.toktokbridge", "TokTok Bridge", "1.0.0")]
    public class TokTokBridgePlugin : BaseUnityPlugin
    {
        // ---- Messages (JsonUtility only handles plain serializable classes) ----
        [Serializable] private class Header { public string type; }
        [Serializable] private class EffectParams { public int count = 1; public string text = ""; }
        [Serializable] private class Context { public string username; public string displayName; public string giftName; public int count; }
        [Serializable] private class EffectMessage { public string type; public string id; public string effect; public EffectParams @params; public Context context; }

        private ConfigEntry<string> _url;
        private ConfigEntry<string> _token;
        private readonly ConcurrentQueue<EffectMessage> _effects = new ConcurrentQueue<EffectMessage>();
        private ClientWebSocket _socket;
        private CancellationTokenSource _cts;

        private void Awake()
        {
            _url = Config.Bind("Connection", "Url", "ws://127.0.0.1:21214", "Adresse du bridge (onglet Intégrations de l'app)");
            _token = Config.Bind("Connection", "Token", "", "Jeton affiché dans l'intégration « Bridge mods »");
            _cts = new CancellationTokenSource();
            Task.Run(() => ConnectLoop(_cts.Token));
        }

        private void OnDestroy()
        {
            _cts?.Cancel();
            _socket?.Dispose();
        }

        // Effects are executed on Unity's main thread.
        private void Update()
        {
            while (_effects.TryDequeue(out var msg))
            {
                string status = "ok", error = "";
                try
                {
                    switch (msg.effect)
                    {
                        case "spawn_cube":
                            for (int i = 0; i < Mathf.Clamp(msg.@params.count, 1, 20); i++) SpawnCube(msg.context?.username);
                            break;
                        case "show_message":
                            Logger.LogInfo($"[LIVE] {msg.context?.displayName}: {msg.@params.text}");
                            break;
                        default:
                            status = "error"; error = "effet inconnu";
                            break;
                    }
                }
                catch (Exception e) { status = "error"; error = e.Message; }
                _ = Send($"{{\"type\":\"result\",\"id\":\"{msg.id}\",\"status\":\"{status}\",\"message\":\"{Escape(error)}\"}}");
            }
        }

        private void SpawnCube(string owner)
        {
            var cam = Camera.main;
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = "TokTok cube " + owner;
            cube.transform.position = cam != null ? cam.transform.position + cam.transform.forward * 4f + UnityEngine.Random.insideUnitSphere : Vector3.zero;
            cube.AddComponent<Rigidbody>();
        }

        private async Task ConnectLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    _socket = new ClientWebSocket();
                    await _socket.ConnectAsync(new Uri(_url.Value), ct);
                    await Send(HelloJson());
                    Logger.LogInfo("Connecté à TokTok Game Connector Live");
                    await ReceiveLoop(ct);
                }
                catch (Exception e) when (!ct.IsCancellationRequested)
                {
                    Logger.LogDebug("Bridge indisponible : " + e.Message);
                }
                await Task.Delay(3000, ct).ContinueWith(_ => { });
            }
        }

        private async Task ReceiveLoop(CancellationToken ct)
        {
            var buffer = new byte[64 * 1024];
            var sb = new StringBuilder();
            while (_socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var res = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (res.MessageType == WebSocketMessageType.Close) break;
                sb.Append(Encoding.UTF8.GetString(buffer, 0, res.Count));
                if (!res.EndOfMessage) continue;
                var json = sb.ToString();
                sb.Clear();
                var header = JsonUtility.FromJson<Header>(json);
                if (header?.type == "effect") _effects.Enqueue(JsonUtility.FromJson<EffectMessage>(json));
                else if (header?.type == "error") Logger.LogWarning("Bridge : " + json);
            }
        }

        private string HelloJson() =>
            "{\"type\":\"hello\",\"protocol\":1,\"token\":\"" + Escape(_token.Value) + "\"," +
            "\"mod\":{\"id\":\"toktok-bepinex-demo\",\"name\":\"Démo Unity\",\"version\":\"1.0.0\"}," +
            "\"effects\":[" +
            "{\"id\":\"spawn_cube\",\"name\":\"Faire tomber des cubes\",\"params\":{\"count\":{\"type\":\"int\",\"label\":\"Nombre\",\"default\":1,\"min\":1,\"max\":20}}}," +
            "{\"id\":\"show_message\",\"name\":\"Afficher un message\",\"params\":{\"text\":{\"type\":\"string\",\"label\":\"Texte\",\"default\":\"Merci {displayName} !\"}}}" +
            "]}";

        private async Task Send(string json)
        {
            var s = _socket;
            if (s == null || s.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(json);
            await s.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }

        private static string Escape(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
