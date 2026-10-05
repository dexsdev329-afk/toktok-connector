import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../shared/api';

const electron = vi.hoisted(() => ({ isPackaged: true }));
const fake = vi.hoisted(() => ({ updater: null as unknown }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.isPackaged;
    },
    getVersion: () => '0.1.0',
  },
}));
vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      return fake.updater;
    },
  },
}));

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  logger: unknown = null;
  checkForUpdates = vi.fn(async () => {
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.2.0', releaseNotes: '<p>Kick &amp; overlays</p>' });
    return null;
  });
  downloadUpdate = vi.fn(async () => {
    this.emit('download-progress', { percent: 42.4 });
    this.emit('update-downloaded', { version: '0.2.0' });
    return [];
  });
  quitAndInstall = vi.fn();
}

function settingsRepo() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(k: string, d: T) => (store.has(k) ? (store.get(k) as T) : d),
    set: (k: string, v: unknown) => void store.set(k, v),
  };
}

async function make() {
  const { Updater } = await import('./updater');
  const states: UpdateState[] = [];
  const u = new Updater(
    settingsRepo() as never,
    (s) => states.push(s),
    () => undefined,
  );
  return { u, states };
}

describe('Updater', () => {
  beforeEach(() => {
    electron.isPackaged = true;
    fake.updater = new FakeUpdater();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });

  it('checks, downloads on demand and installs', async () => {
    const { u } = await make();
    const f = fake.updater as FakeUpdater;
    expect(f.autoDownload).toBe(false);
    expect(f.autoInstallOnAppQuit).toBe(true);
    const s = await u.check();
    expect(s).toMatchObject({ status: 'available', version: '0.2.0', notes: 'Kick & overlays' });
    expect(f.downloadUpdate).not.toHaveBeenCalled();
    await u.download();
    expect(u.get()).toMatchObject({ status: 'downloaded', version: '0.2.0' });
    u.install();
    expect(f.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('reports errors and remembers the auto-check setting', async () => {
    const { u, states } = await make();
    (fake.updater as FakeUpdater).checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await u.check();
    expect(u.get()).toMatchObject({ status: 'error', error: 'offline' });
    expect(u.setAutoCheck(false).autoCheck).toBe(false);
    expect(states.at(-1)?.autoCheck).toBe(false);
  });

  it('is disabled in development', async () => {
    electron.isPackaged = false;
    const { u } = await make();
    expect((await u.check()).status).toBe('disabled');
    u.install();
    expect((fake.updater as FakeUpdater).quitAndInstall).not.toHaveBeenCalled();
  });
});
