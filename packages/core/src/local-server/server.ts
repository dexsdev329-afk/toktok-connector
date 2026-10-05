import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { OverlayServerMessage } from '@toktok/shared';
import { WebSocketServer, type WebSocket } from 'ws';

export function generateToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface OverlayAccess {
  id: string;
  token: string;
}

export interface LocalServerOptions {
  port: number;
  /** Directory of the built overlays app (index.html + assets/). */
  overlaysDir: string;
  /** Resolves an overlay id to its access token (null = unknown overlay). */
  getOverlay: (id: string) => OverlayAccess | null;
  /** Messages sent to an overlay right after it connects (config + current state). */
  initialMessages: (overlayId: string) => OverlayServerMessage[];
  /** Token for the local HTTP API (Stream Deck etc.). */
  apiToken: () => string;
  /** Manual action trigger from the local API. Returns false when unknown. */
  triggerAction?: (actionId: string) => boolean;
  /** Resolves a cached gift image file (public, no token needed). */
  giftImagePath?: (giftId: string) => string | null;
  /** Resolves an imported sound file by id. */
  soundPath?: (soundId: string) => string | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/**
 * Local HTTP + WebSocket server for overlays and the local API.
 *
 * Security model: bound to 127.0.0.1 only; Host header checked (DNS rebinding);
 * WebSocket Origin must be our own origin (or absent, e.g. OBS); every overlay
 * URL carries a random token; the API requires a bearer token.
 */
export class LocalServer {
  private server: Server | null = null;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private readonly overlaySockets = new Map<string, Set<WebSocket>>();
  private actualPort = 0;

  constructor(private readonly opts: LocalServerOptions) {}

  get port(): number {
    return this.actualPort;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.actualPort}`;
  }

  overlayUrl(o: OverlayAccess): string {
    return `${this.origin}/o/${encodeURIComponent(o.id)}?t=${encodeURIComponent(o.token)}`;
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handleHttp(req, res).catch(() => this.send(res, 500, 'Erreur interne'));
    });
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const addr = server.address();
    this.actualPort = typeof addr === 'object' && addr ? addr.port : this.opts.port;
    this.server = server;
  }

  async stop(): Promise<void> {
    for (const set of this.overlaySockets.values()) for (const ws of set) ws.terminate();
    this.overlaySockets.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Sends a message to every connected page of one overlay. */
  sendToOverlay(overlayId: string, msg: OverlayServerMessage): void {
    const set = this.overlaySockets.get(overlayId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  /** Closes the pages of an overlay (e.g. after its token was regenerated). */
  disconnectOverlay(overlayId: string): void {
    for (const ws of this.overlaySockets.get(overlayId) ?? []) ws.close(4001, 'token changed');
  }

  connectedCount(overlayId: string): number {
    return this.overlaySockets.get(overlayId)?.size ?? 0;
  }

  private allowedHosts(): Set<string> {
    return new Set([`127.0.0.1:${this.actualPort}`, `localhost:${this.actualPort}`]);
  }

  private hostOk(req: IncomingMessage): boolean {
    return this.allowedHosts().has((req.headers.host ?? '').toLowerCase());
  }

  private originOk(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return true; // OBS / LIVE Studio browser sources may omit it
    try {
      const u = new URL(origin);
      return u.protocol === 'http:' && this.allowedHosts().has(u.host.toLowerCase());
    } catch {
      return false;
    }
  }

  private checkOverlay(id: string | null, token: string | null): OverlayAccess | null {
    if (!id || !token) return null;
    const o = this.opts.getOverlay(id);
    return o && safeEqual(o.token, token) ? o : null;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.hostOk(req)) return this.send(res, 421, 'Hôte refusé');
    const url = new URL(req.url ?? '/', this.origin);
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && parts[0] === 'o' && parts.length === 2) {
      const overlay = this.checkOverlay(decodeURIComponent(parts[1]!), url.searchParams.get('t'));
      if (!overlay) return this.send(res, 403, 'Lien d’overlay invalide');
      return this.serveFile(res, path.join(this.opts.overlaysDir, 'index.html'), {
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
      });
    }

    if (req.method === 'GET' && parts[0] === 'assets' && parts.length >= 2) {
      const root = path.resolve(this.opts.overlaysDir, 'assets');
      const file = path.resolve(root, ...parts.slice(1).map((p) => decodeURIComponent(p)));
      if (!file.startsWith(root + path.sep)) return this.send(res, 404, 'Introuvable');
      return this.serveFile(res, file, { 'Cache-Control': 'public, max-age=3600' });
    }

    if (req.method === 'GET' && parts[0] === 'gift-img' && parts.length === 2) {
      const file = this.opts.giftImagePath?.(decodeURIComponent(parts[1]!)) ?? null;
      if (!file) return this.send(res, 404, 'Introuvable');
      return this.serveFile(res, file, {
        'Cache-Control': 'public, max-age=86400',
        'Content-Type': 'image/webp',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    }

    if (req.method === 'GET' && parts[0] === 'sounds' && parts.length === 2) {
      const file = this.opts.soundPath?.(decodeURIComponent(parts[1]!)) ?? null;
      if (!file) return this.send(res, 404, 'Introuvable');
      return this.serveFile(res, file, { 'Cache-Control': 'no-cache' });
    }

    if (parts[0] === 'api') return this.handleApi(req, res, parts.slice(1));

    if (req.method === 'GET' && url.pathname === '/health') return this.send(res, 200, 'ok');
    return this.send(res, 404, 'Introuvable');
  }

  private handleApi(req: IncomingMessage, res: ServerResponse, parts: string[]): void {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !safeEqual(token, this.opts.apiToken())) return this.send(res, 401, 'Jeton invalide');
    // Browsers cannot send Authorization cross-origin without a CORS preflight, which we never accept.
    if (req.method === 'POST' && parts[0] === 'actions' && parts[2] === 'trigger' && parts[1]) {
      const ok = this.opts.triggerAction?.(decodeURIComponent(parts[1])) ?? false;
      return this.send(res, ok ? 202 : 404, ok ? 'ok' : 'Action inconnue');
    }
    return this.send(res, 404, 'Introuvable');
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const reject = (code: number) => {
      socket.write(`HTTP/1.1 ${code} Forbidden\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!this.hostOk(req) || !this.originOk(req)) return reject(403);
    const url = new URL(req.url ?? '/', this.origin);
    if (url.pathname !== '/ws/overlay') return reject(404);
    const overlay = this.checkOverlay(url.searchParams.get('id'), url.searchParams.get('t'));
    if (!overlay) return reject(403);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      let set = this.overlaySockets.get(overlay.id);
      if (!set) this.overlaySockets.set(overlay.id, (set = new Set()));
      set.add(ws);
      ws.on('close', () => set!.delete(ws));
      ws.on('error', () => ws.terminate());
      // Overlays are receive-only; ignore anything they send.
      ws.on('message', () => undefined);
      for (const msg of this.opts.initialMessages(overlay.id)) ws.send(JSON.stringify(msg));
    });
  }

  private async serveFile(res: ServerResponse, file: string, headers: Record<string, string>): Promise<void> {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return this.send(res, 404, 'Introuvable');
    } catch {
      return this.send(res, 404, 'Introuvable');
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      ...headers,
    });
    createReadStream(file).pipe(res);
  }

  private send(res: ServerResponse, status: number, body: string): void {
    if (res.headersSent) return void res.end();
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
  }
}
