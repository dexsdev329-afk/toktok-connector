import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { timingSafeEqual } from 'node:crypto';
import { RoomHub, type Client } from './hub.js';
import { loadPins, savePins } from './pin-store.js';

const PORT = Number(process.env.PORT ?? 8080);
const ROOM_COUNT = Number(process.env.ROOM_COUNT ?? 20);
const DEFAULT_PIN = process.env.ROOM_DEFAULT_PIN ?? '0000';
const PINS_FILE = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'pins.json') : null;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const pins = loadPins({
  roomCount: ROOM_COUNT,
  defaultPin: DEFAULT_PIN,
  envPins: process.env.ROOM_PINS,
  file: PINS_FILE,
});
const hub = new RoomHub({
  pins,
  onPinsChanged: (p) => {
    if (!PINS_FILE) return console.warn('DATA_DIR non défini : le nouveau PIN sera perdu au redémarrage');
    savePins(PINS_FILE, p);
  },
});

function adminOk(header: string | undefined): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!ADMIN_TOKEN || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const clientJs = readFileSync(path.join(here, '..', 'public', 'toktok-room-client.js'));

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ...hub.stats() }));
  }
  // Forgotten PIN: POST /admin/reset-pin?room=N with "Authorization: Bearer <ADMIN_TOKEN>".
  if (req.method === 'POST' && url.pathname === '/admin/reset-pin') {
    if (!adminOk(req.headers.authorization)) {
      res.writeHead(401);
      return res.end('unauthorized');
    }
    const room = Number(url.searchParams.get('room'));
    if (!Number.isInteger(room) || room < 1 || room > ROOM_COUNT) {
      res.writeHead(400);
      return res.end('bad room');
    }
    hub.setPin(room, DEFAULT_PIN);
    res.writeHead(200);
    return res.end(`room ${room} reset`);
  }
  if (url.pathname === '/toktok-room-client.js') {
    // Browser games load this helper from any origin.
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    });
    return res.end(clientJs);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('TokTok rooms server');
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  // Behind Railway's proxy the real client address is the last X-Forwarded-For entry
  // (earlier entries can be forged by the client).
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .pop()
    ?.trim();
  const client: Client = {
    ip: forwarded || req.socket.remoteAddress || 'unknown',
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
  };
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);
  hub.connect(client);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) hub.handle(client, String(data));
  });
  ws.on('close', () => {
    clearInterval(heartbeat);
    hub.disconnect(client);
  });
  ws.on('error', () => ws.terminate());
});

server.listen(PORT, () => {
  console.log(`TokTok rooms server on :${PORT} — ${pins.size} salle(s) ouverte(s) sur ${ROOM_COUNT}`);
  if (!PINS_FILE) console.warn('DATA_DIR non défini : les PIN modifiés ne survivront pas à un redémarrage');
});
