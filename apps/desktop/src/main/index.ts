import { FREE_ENTITLEMENTS } from '@toktok/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, session, shell } from 'electron';
import type { PushEvents } from '../shared/api';
import { AppCore } from './app-core';
import { registerIpc } from './ipc';
import { Updater } from './updater';
import { AccountService } from './account';

import { configureSafeStorageForDev, loadGamepadDriver, loadInputDriver, safeStorageCipher } from './native';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let core: AppCore | null = null;
let updater: Updater | null = null;
let account: AccountService | null = null;

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

function push<K extends keyof PushEvents>(channel: K, payload: PushEvents[K]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`push:${channel}`, payload);
}

function overlaysDir(): string {
  // Packaged: copied as an extra resource. Dev: the monorepo build output.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'overlays')
    : path.resolve(__dirname, '../../../overlays/dist');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b14',
    title: 'TokTok Game Connector Live',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Never open new windows or navigate away from the app; external links go to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow?.webContents.getURL()) e.preventDefault();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Deny every permission request (camera, notifications...) from web content.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    configureSafeStorageForDev();

    core = new AppCore({
      dataDir: app.getPath('userData'),
      overlaysDir: overlaysDir(),
      cipher: safeStorageCipher,
      input: loadInputDriver((m) => log('warn', m)),
      gamepad: loadGamepadDriver((m) => log('warn', m)),
      // The account is created right after the core (it needs its database).
      entitlements: { current: () => account?.current() ?? FREE_ENTITLEMENTS },
      log,
      push: {
        connection: (platform, info) => push('connection', { platform, info }),
        session: (info) => push('session', info),
        journal: (entries) => push('journal', entries),
        integrations: () => push('integrations', undefined),
        media: (req) => push('media', req),
      },
    });
    const dev = !app.isPackaged;
    const appCore = core;
    account = new AccountService({
      settings: core.repos.settings,
      secrets: core.repos.secrets,
      log,
      // Development only: TOKTOK_DEV_PRO=1 unlocks everything, TOKTOK_ACCOUNT_SERVER points to a local server.
      devPro: dev && process.env.TOKTOK_DEV_PRO === '1',
      ...(dev && process.env.TOKTOK_ACCOUNT_SERVER ? { serverUrl: process.env.TOKTOK_ACCOUNT_SERVER } : {}),
      onChange: (state) => {
        push('account', state);
        void appCore.applyEntitlements().catch((err: unknown) => log('error', String(err)));
      },
    });
    updater = new Updater(core.repos.settings, (s) => push('updates', s), log);
    registerIpc(core, updater, account, () => mainWindow);
    await core.start();
    account.start();
    updater.start();
    log('info', `Serveur local : ${core.server.port ? core.server.origin : 'indisponible'}`);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !core) return;
    e.preventDefault();
    quitting = true;
    updater?.stop();
    account?.stop();
    core
      .stop()
      .catch((err: unknown) => log('error', String(err)))
      .finally(() => app.quit());
  });
}
