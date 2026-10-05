import { timingSafeEqual } from 'node:crypto';

/**
 * Room relay protocol (JSON text frames):
 *
 * client -> server
 *   {type:"join", room:1..N, pin:"1234", role:"publisher"|"game", name?:string}
 *   publisher: {type:"event", event:{...}} | {type:"effect", effect:"name", params:{}, context:{}}
 *   publisher: {type:"setPin", pin:"new-pin"}       (changes the room PIN, saved by the server)
 *   game:      {type:"game", data:{...}}          (forwarded to the publishers of the room)
 *   any:       {type:"ping"}
 * server -> client
 *   {type:"joined", room, role, games, publishers} | {type:"error", message}
 *   {type:"event"|"effect", ...} (to games) | {type:"game", data, from} (to publishers)
 *   {type:"presence", games, publishers} | {type:"pong"} | {type:"pinChanged", room}
 */

export type Role = 'publisher' | 'game';

export interface Client {
  send(data: string): void;
  close(code: number, reason: string): void;
  readonly ip: string;
}

interface Member {
  client: Client;
  room: number;
  role: Role;
  name: string;
  /** Token bucket for rate limiting. */
  tokens: number;
  last: number;
}

export interface HubOptions {
  /** PIN per room number; rooms without a PIN cannot be joined. */
  pins: Map<number, string>;
  /** Called after a PIN change, to persist the new PINs. */
  onPinsChanged?: (pins: Map<number, string>) => void;
  maxMessagesPerSecond?: number;
  maxFailedJoins?: number;
  lockMs?: number;
  now?: () => number;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Parses ROOM_PINS="1:1234,2:5678" (and ignores invalid entries). */
export function parsePins(raw: string | undefined, roomCount = 20): Map<number, string> {
  const pins = new Map<number, string>();
  for (const part of (raw ?? '').split(',')) {
    const [r, p] = part.split(':').map((s) => s.trim());
    const room = Number(r);
    if (Number.isInteger(room) && room >= 1 && room <= roomCount && p && PIN_PATTERN.test(p))
      pins.set(room, p);
  }
  return pins;
}

export const PIN_PATTERN = /^[\w-]{4,64}$/;

export class RoomHub {
  private readonly members = new Map<Client, Member | null>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  private readonly rate: number;
  private readonly maxFailed: number;
  private readonly lockMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: HubOptions) {
    this.rate = opts.maxMessagesPerSecond ?? 50;
    this.maxFailed = opts.maxFailedJoins ?? 5;
    this.lockMs = opts.lockMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  connect(client: Client): void {
    this.members.set(client, null);
  }

  disconnect(client: Client): void {
    const m = this.members.get(client);
    this.members.delete(client);
    if (m) this.broadcastPresence(m.room);
  }

  stats(): { rooms: number; connections: number } {
    return { rooms: this.opts.pins.size, connections: this.members.size };
  }

  handle(client: Client, raw: string): void {
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      msg = parsed as Record<string, unknown>;
    } catch {
      return this.error(client, 'message invalide');
    }
    const member = this.members.get(client) ?? null;
    if (msg.type === 'ping') return client.send(JSON.stringify({ type: 'pong' }));
    if (!member) {
      if (msg.type !== 'join') return this.error(client, 'join attendu');
      return this.join(client, msg);
    }
    if (!this.allow(member)) return this.error(client, 'trop de messages');
    switch (msg.type) {
      case 'event':
      case 'effect':
        if (member.role !== 'publisher') return this.error(client, 'réservé à l’app');
        return this.toRole(member.room, 'game', JSON.stringify(msg));
      case 'setPin': {
        // Only the app (publisher) may change the PIN; games never can.
        if (member.role !== 'publisher') return this.error(client, 'réservé à l’app');
        const pin = typeof msg.pin === 'string' ? msg.pin.trim() : '';
        if (!PIN_PATTERN.test(pin))
          return this.error(client, 'PIN invalide (4 à 64 caractères : lettres, chiffres, - ou _)');
        this.setPin(member.room, pin);
        return client.send(JSON.stringify({ type: 'pinChanged', room: member.room }));
      }
      case 'game':
        if (member.role !== 'game') return this.error(client, 'réservé aux jeux');
        return this.toRole(
          member.room,
          'publisher',
          JSON.stringify({ type: 'game', data: msg.data ?? null, from: member.name }),
        );
      default:
        return this.error(client, 'type inconnu');
    }
  }

  /** Changes (or resets) a room PIN and persists it. Connected members stay connected. */
  setPin(room: number, pin: string): void {
    this.opts.pins.set(room, pin);
    this.opts.onPinsChanged?.(this.opts.pins);
  }

  private join(client: Client, msg: Record<string, unknown>): void {
    const now = this.now();
    const f = this.failures.get(client.ip);
    if (f && f.until > now) {
      this.error(client, 'trop d’essais, réessaie plus tard');
      return client.close(4008, 'locked');
    }
    const room = Number(msg.room);
    const pin = typeof msg.pin === 'string' ? msg.pin : '';
    const role = msg.role === 'publisher' || msg.role === 'game' ? msg.role : null;
    const expected = this.opts.pins.get(room);
    if (!role || !expected || !safeEqual(pin, expected)) {
      const count = (f && f.until <= now && f.count >= this.maxFailed ? 0 : (f?.count ?? 0)) + 1;
      this.failures.set(client.ip, { count, until: count >= this.maxFailed ? now + this.lockMs : 0 });
      this.error(client, 'salle ou PIN invalide');
      return client.close(4003, 'bad pin');
    }
    this.failures.delete(client.ip);
    const name = typeof msg.name === 'string' ? msg.name.slice(0, 40) : role;
    this.members.set(client, { client, room, role, name, tokens: this.rate, last: now });
    const counts = this.counts(room);
    client.send(JSON.stringify({ type: 'joined', room, role, ...counts }));
    this.broadcastPresence(room);
  }

  private allow(m: Member): boolean {
    const now = this.now();
    m.tokens = Math.min(this.rate, m.tokens + ((now - m.last) / 1000) * this.rate);
    m.last = now;
    if (m.tokens < 1) return false;
    m.tokens -= 1;
    return true;
  }

  private counts(room: number): { games: number; publishers: number } {
    let games = 0;
    let publishers = 0;
    for (const m of this.members.values()) {
      if (m?.room !== room) continue;
      if (m.role === 'game') games++;
      else publishers++;
    }
    return { games, publishers };
  }

  private broadcastPresence(room: number): void {
    const data = JSON.stringify({ type: 'presence', ...this.counts(room) });
    for (const m of this.members.values()) if (m?.room === room) m.client.send(data);
  }

  private toRole(room: number, role: Role, data: string): void {
    for (const m of this.members.values()) if (m?.room === room && m.role === role) m.client.send(data);
  }

  private error(client: Client, message: string): void {
    client.send(JSON.stringify({ type: 'error', message }));
  }
}
