/**
 * Browser helper served at http://127.0.0.1:<port>/toktok-game-client.js for home games.
 * Same API as the rooms server client, so a game works locally and through Railway.
 *
 *   <script src="http://127.0.0.1:21213/toktok-game-client.js"></script>
 *   const game = TokTokGame.connect(); // reads ?toktok_ws=... from the page URL
 *   game.on('event', (e) => { if (e.type === 'gift') dropCoins(e.count); });
 *   game.on('effect', (fx) => { if (fx.effect === 'bonus') startBonus(fx.params); });
 *   game.send({ score: 42 });
 */
export const GAME_CLIENT_SCRIPT = `(function (global) {
  function connect(opts) {
    opts = opts || {};
    var url = opts.url || new URLSearchParams(location.search).get('toktok_ws');
    if (!url) { console.warn('TokTokGame: paramètre toktok_ws manquant'); }
    var listeners = {}, ws = null, closed = false, retry = 1000;
    function emit(type, payload) {
      (listeners[type] || []).forEach(function (fn) { try { fn(payload); } catch (e) { console.error(e); } });
    }
    function open() {
      if (!url) return;
      ws = new WebSocket(url);
      ws.onopen = function () { retry = 1000; emit('open'); };
      ws.onmessage = function (m) {
        var msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
        if (msg.type === 'event') emit('event', msg.event);
        else if (msg.type === 'effect') emit('effect', msg);
        else emit(msg.type, msg);
      };
      ws.onclose = function () {
        emit('close');
        if (closed) return;
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 15000);
      };
    }
    open();
    return {
      on: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); return this; },
      send: function (data) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'game', data: data })); },
      close: function () { closed = true; if (ws) ws.close(); }
    };
  }
  global.TokTokGame = { connect: connect };
})(window);
`;
