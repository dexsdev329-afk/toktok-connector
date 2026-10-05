import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { totalmem } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MinecraftServerState } from '../shared/api';

/**
 * "Minecraft in one click": installs and runs a personal Minecraft Java server on the streamer's
 * PC, already configured for the app (RCON on 127.0.0.1 with a random password).
 * - Java: Eclipse Temurin JRE (Adoptium API), the major version required by the Minecraft version.
 * - Server: the official server.jar from Mojang's version manifest (SHA-1 checked). Nothing is
 *   redistributed: both are downloaded from their publishers, and the Minecraft EULA must be
 *   accepted by the user before the server can run.
 */

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const ADOPTIUM = 'https://api.adoptium.net/v3/assets/latest';
export const MINECRAFT_EULA_URL = 'https://aka.ms/MinecraftEULA';
const ALLOWED_DOWNLOAD_HOSTS =
  /(^|\.)(mojang\.com|minecraft\.net|adoptium\.net|github\.com|githubusercontent\.com)$/i;

export interface ServerSettings {
  version?: string;
  javaPath?: string;
  javaMajor?: number;
  rconPort?: number;
  rconPassword?: string;
  serverPort?: number;
}

export interface ManagerOptions {
  dir: string;
  load: () => ServerSettings;
  save: (s: ServerSettings) => void;
  push: (state: MinecraftServerState) => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Called once the server accepts RCON connections. */
  onReady: (rcon: { port: number; password: string }) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
}

interface VersionEntry {
  id: string;
  type: string;
  url: string;
}

export class MinecraftServerManager {
  private state: MinecraftServerState;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly logs: string[] = [];
  private readonly players = new Set<string>();
  private readonly fetchImpl: typeof fetch;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly opts: ManagerOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.platform = opts.platform ?? process.platform;
    const s = opts.load();
    this.state = {
      status: s.version ? 'stopped' : 'not-installed',
      version: s.version ?? null,
      players: [],
      logs: [],
    };
  }

  get(): MinecraftServerState {
    return { ...this.state, players: [...this.players], logs: this.logs.slice(-80) };
  }

  /** Recent release versions, newest first. */
  async versions(): Promise<{ latest: string; versions: string[] }> {
    const manifest = (await this.json(MANIFEST)) as { latest: { release: string }; versions: VersionEntry[] };
    return {
      latest: manifest.latest.release,
      versions: manifest.versions
        .filter((v) => v.type === 'release')
        .slice(0, 30)
        .map((v) => v.id),
    };
  }

  /** Downloads Java + the server for `version`, accepts the EULA (user consent), configures RCON. */
  async install(version: string, acceptEula: boolean): Promise<void> {
    if (!acceptEula) throw new Error('Il faut accepter le CLUF de Minecraft pour installer le serveur');
    if (this.proc) throw new Error('Arrête le serveur avant de changer de version');
    if (this.state.status === 'installing') return;
    try {
      this.set({ status: 'installing', step: 'Recherche de la version…', percent: 0, error: undefined });
      const manifest = (await this.json(MANIFEST)) as { versions: VersionEntry[] };
      const entry = manifest.versions.find((v) => v.id === version);
      if (!entry) throw new Error(`Version inconnue : ${version}`);
      const meta = (await this.json(entry.url)) as {
        downloads?: { server?: { url: string; sha1: string; size: number } };
        javaVersion?: { majorVersion?: number };
      };
      const server = meta.downloads?.server;
      if (!server) throw new Error(`Pas de serveur officiel pour la version ${version}`);
      const javaMajor = meta.javaVersion?.majorVersion ?? 21;

      await fs.mkdir(this.opts.dir, { recursive: true });
      const settings = this.opts.load();
      const javaPath =
        settings.javaPath && settings.javaMajor === javaMajor && (await exists(settings.javaPath))
          ? settings.javaPath
          : await this.installJava(javaMajor);

      this.set({ step: `Téléchargement du serveur Minecraft ${version}…`, percent: 0 });
      const jar = path.join(this.opts.dir, 'server.jar');
      await this.download(server.url, jar, server.size);
      if ((await fileHash(jar, 'sha1')) !== server.sha1) throw new Error('Fichier serveur corrompu (SHA-1)');

      this.set({ step: 'Configuration…', percent: 100 });
      await fs.writeFile(
        path.join(this.opts.dir, 'eula.txt'),
        `# Accepted in TokTok Game Connector Live on ${new Date().toISOString()} (${MINECRAFT_EULA_URL})\neula=true\n`,
      );
      const rconPort = settings.rconPort ?? (await freePort(25575));
      const serverPort = settings.serverPort ?? (await freePort(25565));
      const rconPassword = settings.rconPassword ?? randomBytes(18).toString('base64url');
      await writeProperties(path.join(this.opts.dir, 'server.properties'), {
        'enable-rcon': 'true',
        'rcon.port': String(rconPort),
        'rcon.password': rconPassword,
        'broadcast-rcon-to-ops': 'false',
        'server-port': String(serverPort),
        // RCON binds to server-ip: keep both the game and RCON on this PC only.
        'server-ip': '127.0.0.1',
        motd: 'Serveur TokTok Live',
        'spawn-protection': '0',
        'max-players': '20',
        'online-mode': 'true',
      });
      this.opts.save({ ...settings, version, javaPath, javaMajor, rconPort, rconPassword, serverPort });
      this.set({ status: 'stopped', version, step: undefined, percent: undefined });
      this.opts.log('info', `Serveur Minecraft ${version} installé`);
    } catch (err) {
      this.fail(err);
      throw err;
    }
  }

  async start(): Promise<void> {
    if (this.proc) return;
    const s = this.opts.load();
    if (!s.version || !s.javaPath || !s.rconPort || !s.rconPassword)
      throw new Error('Serveur pas encore installé');
    // Re-asserted at every start in case the file was edited by hand.
    await writeProperties(path.join(this.opts.dir, 'server.properties'), {
      'enable-rcon': 'true',
      'server-ip': '127.0.0.1',
      'rcon.port': String(s.rconPort),
      'rcon.password': s.rconPassword,
    });
    const maxGb = Math.max(1, Math.min(4, Math.floor(totalmem() / 1024 ** 3 / 4)));
    this.logs.length = 0;
    this.players.clear();
    this.set({
      status: 'starting',
      step: 'Démarrage du serveur (génération du monde au premier lancement)…',
      error: undefined,
    });
    const proc = spawn(s.javaPath, [`-Xms1G`, `-Xmx${maxGb}G`, '-jar', 'server.jar', 'nogui'], {
      cwd: this.opts.dir,
      windowsHide: true,
    });
    this.proc = proc;
    const onLine = (line: string) => this.onLine(line, s);
    lines(proc.stdout, onLine);
    lines(proc.stderr, onLine);
    proc.on('error', (err) => this.fail(err));
    proc.on('exit', (code) => {
      this.proc = null;
      this.players.clear();
      if (this.state.status === 'error') return;
      if (code && this.state.status !== 'stopping') {
        this.fail(new Error(`Le serveur s’est arrêté (code ${code}) : ${this.logs.slice(-3).join(' / ')}`));
      } else {
        this.set({ status: 'stopped', step: undefined });
      }
    });
  }

  /** Saves the world and stops the server (killed after 30 s). */
  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.set({ status: 'stopping', step: 'Sauvegarde du monde et arrêt…' });
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    proc.stdin.write('stop\n');
    const timer = setTimeout(() => proc.kill(), 30_000);
    await exited;
    clearTimeout(timer);
  }

  folder(): string {
    return this.opts.dir;
  }

  // ------------------------------------------------------------ internals

  private onLine(line: string, s: ServerSettings): void {
    const clean = line.replace(/\r$/, '');
    if (!clean.trim()) return;
    this.logs.push(clean.slice(0, 300));
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
    const joined = /: (\w{1,16}) joined the game/.exec(clean);
    const left = /: (\w{1,16}) left the game/.exec(clean);
    if (joined) this.players.add(joined[1]!);
    if (left) this.players.delete(left[1]!);
    if (/RCON running on/.test(clean) && this.state.status === 'starting') {
      this.set({ status: 'running', step: undefined });
      this.opts.log('info', `Serveur Minecraft prêt (localhost:${s.serverPort ?? 25565})`);
      void Promise.resolve(this.opts.onReady({ port: s.rconPort!, password: s.rconPassword! })).catch(
        (err: unknown) => this.opts.log('warn', `Minecraft : ${String(err)}`),
      );
      return;
    }
    if (/Failed to bind to port|FAILED TO BIND/i.test(clean)) {
      this.opts.log('warn', 'Minecraft : port déjà utilisé (un autre serveur tourne ?)');
    }
    this.push();
  }

  private async installJava(major: number): Promise<string> {
    this.set({ step: `Téléchargement de Java ${major}…`, percent: 0 });
    const os = this.platform === 'win32' ? 'windows' : this.platform === 'darwin' ? 'mac' : 'linux';
    const assets = (await this.json(
      `${ADOPTIUM}/${major}/hotspot?architecture=x64&image_type=jre&os=${os}&vendor=eclipse`,
    )) as { binary: { package: { link: string; checksum: string; size: number; name: string } } }[];
    const pkg = assets[0]?.binary.package;
    if (!pkg) throw new Error(`Java ${major} introuvable pour ce système`);
    const archive = path.join(this.opts.dir, pkg.name.replace(/[^\w.-]/g, '_'));
    await this.download(pkg.link, archive, pkg.size);
    if ((await fileHash(archive, 'sha256')) !== pkg.checksum)
      throw new Error('Archive Java corrompue (SHA-256)');
    this.set({ step: 'Installation de Java…' });
    const target = path.join(this.opts.dir, `java-${major}`);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });
    // tar is built into Windows 10+ and extracts .zip archives too.
    await run('tar', [archive.endsWith('.zip') ? '-xf' : '-xzf', archive, '-C', target]);
    await fs.rm(archive, { force: true });
    const [root] = await fs.readdir(target);
    const bin = path.join(target, root ?? '', this.platform === 'darwin' ? 'Contents/Home/bin' : 'bin');
    const java = path.join(bin, this.platform === 'win32' ? 'java.exe' : 'java');
    if (!(await exists(java))) throw new Error('Java installé mais introuvable');
    return java;
  }

  private async json(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} (${new URL(url).hostname})`);
    return res.json();
  }

  private async download(url: string, file: string, size: number): Promise<void> {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.test(u.hostname))
      throw new Error(`Source refusée : ${u.hostname}`);
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
    let received = 0;
    let lastPush = 0;
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastPush > 250 && size > 0) {
        lastPush = now;
        this.set({ percent: Math.min(99, Math.round((received / size) * 100)) });
      }
    });
    await pipeline(body, createWriteStream(file));
    this.set({ percent: 100 });
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.opts.log('error', `Minecraft : ${message}`);
    this.set({ status: 'error', error: message.slice(0, 400), step: undefined, percent: undefined });
  }

  private set(patch: Partial<MinecraftServerState>): void {
    this.state = { ...this.state, ...patch };
    for (const k of Object.keys(patch) as (keyof MinecraftServerState)[]) {
      if (patch[k] === undefined) delete this.state[k];
    }
    this.push();
  }

  private push(): void {
    this.opts.push(this.get());
  }
}

// ---------------------------------------------------------------- helpers

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

async function fileHash(file: string, algo: 'sha1' | 'sha256'): Promise<string> {
  const hash = createHash(algo);
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} : ${err.slice(0, 200) || code}`)),
    );
  });
}

function lines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buf = '';
  stream.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
}

/** First free TCP port on 127.0.0.1 from `start`. */
export async function freePort(start: number): Promise<number> {
  for (let port = start; port < start + 50; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error(`Aucun port libre à partir de ${start}`);
}

/** Updates (or creates) server.properties, keeping the other keys. */
export async function writeProperties(file: string, values: Record<string, string>): Promise<void> {
  const current = await fs.readFile(file, 'utf8').catch(() => '');
  const seen = new Set<string>();
  const out = current
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => {
      const k = l.split('=')[0]!;
      if (!l.startsWith('#') && k in values) {
        seen.add(k);
        return `${k}=${values[k]}`;
      }
      return l;
    });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}=${v}`);
  await fs.writeFile(file, `${out.join('\n')}\n`);
}
