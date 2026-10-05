/**
 * TokTok room client for browser games (no dependency).
 *
 *   <script src="https://<rooms-server>/toktok-room-client.js"></script>
 *   const room = TokTokRoom.connect({ url: 'wss://<rooms-server>', room: 3, pin: '1234', name: 'coin-pusher' });
 *   room.on('event', (e) => { if (e.type === 'gift') dropCoins(e.count); });
 *   room.on('effect', (fx) => { if (fx.effect === 'bonus') startBonus(fx.params); });
 *   room.send({ score: 42 }); // forwarded to the app
 */
(function (global) {
  function connect(opts) {
    var listeners = {};
    var ws = null;
    var closed = false;
    var retry = 1000;
    function emit(type, payload) {
      (listeners[type] || []).forEach(function (fn) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      });
    }
    function open() {
      ws = new WebSocket(opts.url);
      ws.onopen = function () {
        retry = 1000;
        ws.send(
          JSON.stringify({
            type: 'join',
            room: opts.room,
            pin: opts.pin,
            role: 'game',
            name: opts.name || 'game',
          }),
        );
      };
      ws.onmessage = function (m) {
        var msg;
        try {
          msg = JSON.parse(m.data);
        } catch {
          return;
        }
        if (msg.type === 'event') emit('event', msg.event);
        else if (msg.type === 'effect') emit('effect', msg);
        else emit(msg.type, msg);
      };
      ws.onclose = function (e) {
        emit('close', e);
        if (closed || e.code === 4003 || e.code === 4008) return; // bad PIN / locked: do not hammer
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 15000);
      };
    }
    open();
    return {
      on: function (type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
        return this;
      },
      send: function (data) {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'game', data: data }));
      },
      close: function () {
        closed = true;
        if (ws) ws.close();
      },
    };
  }
  global.TokTokRoom = { connect: connect };
})(typeof window !== 'undefined' ? window : globalThis);
