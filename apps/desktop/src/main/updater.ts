import type { SettingsRepo } from '@toktok/core';
import { app } from 'electron';
// electron-updater is CommonJS: use its default export from this ESM bundle.
import electronUpdater, { type AppUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/api';

const AUTO_CHECK_KEY = 'updates.autoCheck';
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 3_600_000;

/**
 * Auto-update through GitHub Releases (electron-builder `publish: github`, public repository:
 * no token needed). Only active in the installed Windows app. Updates are downloaded when the
 * user asks, and installed on "restart" or when the app quits.
 */
export class Updater {
  private state: UpdateState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly updater: AppUpdater | null;

  constructor(
    private readonly settings: SettingsRepo,
    private readonly push: (s: UpdateState) => void,
    private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void,
  ) {
    const enabled = app.isPackaged && process.platform === 'win32';
    this.state = {
      status: enabled ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      autoCheck: this.settings.get(AUTO_CHECK_KEY, true),
    };
    this.updater = enabled ? electronUpdater.autoUpdater : null;
    if (this.updater) this.bind(this.updater);
  }

  get(): UpdateState {
    return this.state;
  }

  start(): void {
    if (!this.updater) return;
    if (this.state.autoCheck) setTimeout(() => void this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => {
      if (this.state.autoCheck && this.state.status !== 'downloading') void this.check();
    }, CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setAutoCheck(on: boolean): UpdateState {
    this.settings.set(AUTO_CHECK_KEY, on);
    return this.set({ autoCheck: on });
  }

  async check(): Promise<UpdateState> {
    if (!this.updater) return this.state;
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return this.state;
    try {
      await this.updater.checkForUpdates();
    } catch (err) {
      this.fail(err);
    }
    return this.state;
  }

  async download(): Promise<void> {
    if (!this.updater || this.state.status !== 'available') return;
    this.set({ status: 'downloading', percent: 0 });
    try {
      await this.updater.downloadUpdate();
    } catch (err) {
      this.fail(err);
    }
  }

  install(): void {
    if (!this.updater || this.state.status !== 'downloaded') return;
    // Closes the windows, runs the NSIS installer silently and restarts the app.
    this.updater.quitAndInstall(true, true);
  }

  private bind(u: AppUpdater): void {
    u.autoDownload = false;
    u.autoInstallOnAppQuit = true;
    u.logger = {
      info: (m: unknown) => this.log('info', `[update] ${String(m)}`),
      warn: (m: unknown) => this.log('warn', `[update] ${String(m)}`),
      error: (m: unknown) => this.log('error', `[update] ${String(m)}`),
      debug: () => undefined,
    };
    u.on('checking-for-update', () => this.set({ status: 'checking' }));
    u.on('update-available', (info) =>
      this.set({ status: 'available', version: info.version, ...notes(info.releaseNotes) }),
    );
    u.on('update-not-available', () => this.set({ status: 'not-available', checkedAt: Date.now() }));
    u.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }));
    u.on('update-downloaded', (info) => this.set({ status: 'downloaded', version: info.version }));
    u.on('error', (err) => this.fail(err));
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.log('warn', `Mise à jour : ${message}`);
    this.set({ status: 'error', error: message.slice(0, 300) });
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch };
    if (patch.status && patch.status !== 'error') delete this.state.error;
    this.push(this.state);
    return this.state;
  }
}

/** Release notes as plain text (GitHub sends HTML; it is shown as text, never as HTML). */
function notes(raw: unknown): { notes?: string } {
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((n: { note?: unknown }) => (typeof n.note === 'string' ? n.note : '')).join('\n')
        : '';
  const clean = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean ? { notes: clean.slice(0, 2000) } : {};
}
