import { promises as fs } from 'node:fs';
import { TtsSettingsSchema, exportProfile, importProfile } from '@toktok/core';
import {
  ActionSchema,
  EffectSchema,
  OverlayConfigSchema,
  OverlayStyleSchema,
  type ActionInput,
} from '@toktok/shared';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { DesktopApi, IntegrationDefinitionDto } from '../shared/api';
import type { AppCore } from './app-core';
import type { Updater } from './updater';
import type { AccountService } from './account';

const id = z.string().min(1).max(100);
const platformSchema = z.enum(['tiktok', 'kick']);
const emailSchema = z.string().trim().max(254).email();
const passwordSchema = z.string().min(8).max(200);
const simUser = z
  .object({
    username: z.string().max(24).optional(),
    isModerator: z.boolean().optional(),
    isSubscriber: z.boolean().optional(),
  })
  .optional();

const SettingsPatchSchema = z
  .object({
    language: z.enum(['fr', 'en']),
    tiktokUsername: z.string().max(100),
    kickChannel: z.string().max(100),
    streakMode: z.enum(['end', 'repeat']),
    serverPort: z.number().int().min(1024).max(65535),
    engineConcurrency: z.number().int().min(1).max(10),
    engineMaxPerSecond: z.number().int().min(1).max(100),
    signApiKey: z.string().max(500).nullable(),
  })
  .partial()
  .strict();

const IntegrationSaveSchema = z.object({
  id: id.optional(),
  kind: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});

const ActionSaveSchema = ActionSchema.extend({ id: id.optional() });
const OverlaySaveSchema = OverlayConfigSchema.extend({ id: id.optional() });

const gameWindows = new Set<BrowserWindow>();

/** Isolated window for a home game: no Node, no preload, no popups, separate session. */
function openGameWindow(title: string, url: string): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    title,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:home-games',
      backgroundThrottling: false,
    },
  });
  // Games may ask for fullscreen; everything else (camera, mic, notifications…) is refused.
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen'));
  gameWindows.add(win);
  win.on('closed', () => gameWindows.delete(win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const origin = new URL(url).origin;
  win.webContents.on('will-navigate', (e, next) => {
    if (new URL(next).origin !== origin) e.preventDefault();
  });
  void win.loadURL(url);
}

/**
 * zod applies `.default()` values even on a `.partial()` schema: keep only the
 * keys the caller actually sent, so a patch never resets other settings.
 */
function onlyGivenKeys<T extends object>(parsed: T, raw: unknown): Partial<T> {
  const given = raw && typeof raw === 'object' ? Object.keys(raw) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => given.includes(k))) as Partial<T>;
}

type Handlers = { [N in keyof DesktopApi]: { [M in keyof DesktopApi[N]]: (...args: never[]) => unknown } };

/**
 * Registers the single "api" invoke channel. Arguments are validated with zod
 * before reaching the core; only the main window may call it.
 */
export function registerIpc(
  core: AppCore,
  updater: Updater,
  account: AccountService,
  getWindow: () => BrowserWindow | null,
): void {
  const handlers = {
    app: {
      info: () => ({
        version: app.getVersion(),
        dataDir: app.getPath('userData'),
        serverOrigin: core.server.port ? core.server.origin : '',
      }),
    },
    connection: {
      get: () => core.connection(),
      connect: (platform: unknown, channel: unknown) =>
        core.connectPlatform(platformSchema.parse(platform), z.string().min(1).max(100).parse(channel)),
      disconnect: (platform: unknown) => core.disconnectPlatform(platformSchema.parse(platform)),
    },
    session: {
      get: () => core.tracker.get(),
      reset: () => {
        core.tracker.reset();
        core.engine.resetSession();
        core.feeder.refreshAll();
      },
    },
    simulator: {
      gift: (giftId: unknown, count: unknown, user: unknown) =>
        core.simulate(
          'gift',
          { giftId: id.parse(giftId), count: z.number().int().min(1).max(500).parse(count) },
          simUser.parse(user),
        ),
      like: (count: unknown, user: unknown) =>
        core.simulate('like', z.number().int().min(1).max(10_000).parse(count), simUser.parse(user)),
      follow: (user: unknown) => core.simulate('follow', null, simUser.parse(user)),
      share: (user: unknown) => core.simulate('share', null, simUser.parse(user)),
      subscribe: (user: unknown) => core.simulate('subscribe', null, simUser.parse(user)),
      chat: (text: unknown, user: unknown) =>
        core.simulate('chat', z.string().min(1).max(300).parse(text), simUser.parse(user)),
      rain: (seconds: unknown) => core.simulate('rain', z.number().int().min(1).max(120).parse(seconds)),
    },
    gifts: {
      list: () => core.giftList(),
      refresh: () => core.refreshGifts(),
    },
    profiles: {
      list: () => core.repos.profiles.list(),
      create: (name: unknown, game: unknown) =>
        core.repos.profiles.create({
          name: z.string().min(1).max(100).parse(name),
          game: z.string().max(100).parse(game),
        }),
      update: (pid: unknown, name: unknown, game: unknown) =>
        core.repos.profiles.update(id.parse(pid), {
          name: z.string().min(1).max(100).parse(name),
          game: z.string().max(100).parse(game),
        }),
      remove: (pid: unknown) => {
        core.repos.profiles.delete(id.parse(pid));
        core.reloadActions();
      },
      activate: (pid: unknown) => {
        core.repos.profiles.setActive(id.parse(pid));
        core.reloadActions();
      },
      exportToFile: async (pid: unknown) => {
        const data = exportProfile(core.repos.profiles, core.repos.actions, id.parse(pid));
        const win = getWindow();
        const opts = {
          title: 'Exporter le profil',
          defaultPath: `${data.profile.name.replace(/[^\w-]+/g, '_')}.toktok.json`,
          filters: [{ name: 'Profil TokTok', extensions: ['json'] }],
        };
        const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
        if (res.canceled || !res.filePath) return false;
        await fs.writeFile(res.filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
      },
      importFromFile: async () => {
        const win = getWindow();
        const opts = {
          title: 'Importer un profil',
          properties: ['openFile' as const],
          filters: [{ name: 'Profil TokTok', extensions: ['json'] }],
        };
        const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        const file = res.filePaths[0];
        if (res.canceled || !file) return null;
        const stat = await fs.stat(file);
        if (stat.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux');
        const raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
        const profile = importProfile(core.db, core.repos.profiles, core.repos.actions, raw);
        core.reloadActions();
        return profile;
      },
      createMinecraftPack: (iid: unknown) => core.createMinecraftPack(id.parse(iid)),
    },
    actions: {
      list: (pid: unknown) => core.repos.actions.listByProfile(id.parse(pid)),
      save: (input: unknown) => {
        const parsed = ActionSaveSchema.parse(input) as ActionInput & { id?: string };
        if (!parsed.id && !core.canAddAction())
          throw new Error('Limite d’actions atteinte pour cette version');
        const saved = core.repos.actions.save(parsed);
        core.reloadActions();
        return saved;
      },
      remove: (aid: unknown) => {
        core.repos.actions.delete(id.parse(aid));
        core.reloadActions();
      },
      test: (aid: unknown) => {
        const action = core.repos.actions.get(id.parse(aid));
        if (!action) throw new Error('Action introuvable');
        core.testAction(action);
      },
      testEffect: (effect: unknown) => core.testEffect(EffectSchema.parse(effect)),
    },
    integrations: {
      definitions: (): IntegrationDefinitionDto[] =>
        core.integrations.listDefinitions().map((d) => ({
          kind: d.kind,
          name: d.name,
          description: d.description,
          configFields: d.configFields,
          effects: d.effects,
          presets: d.presets ?? [],
        })),
      list: () => core.repos.integrations.list().map((r) => core.integrationDto(r)),
      save: (input: unknown) => core.saveIntegration(IntegrationSaveSchema.parse(input)),
      remove: (iid: unknown) => core.removeIntegration(id.parse(iid)),
      test: (iid: unknown) => core.testIntegration(id.parse(iid)),
      changeRoomPin: (iid: unknown, pin: unknown) =>
        core.changeRoomPin(
          id.parse(iid),
          z
            .string()
            .regex(/^[\w-]{4,64}$/)
            .parse(pin),
        ),
    },
    overlays: {
      list: () => core.repos.overlays.list().map((o) => core.overlayDto(o)),
      save: (input: unknown) => core.saveOverlay(OverlaySaveSchema.parse(input)),
      remove: (oid: unknown) => {
        core.server.disconnectOverlay(id.parse(oid));
        core.repos.overlays.delete(id.parse(oid));
      },
      regenerateToken: (oid: unknown) => core.regenerateOverlayToken(id.parse(oid)),
      spinWheel: (oid: unknown) => core.spinWheel(id.parse(oid)),
      applyStyleToAll: (style: unknown) => core.applyStyleToAll(OverlayStyleSchema.parse(style)),
      timer: (oid: unknown, op: unknown, seconds: unknown) =>
        core.controlTimer(
          id.parse(oid),
          z.enum(['start', 'pause', 'toggle', 'reset', 'add', 'set']).parse(op),
          z
            .number()
            .int()
            .min(-86_400)
            .max(86_400)
            .parse(seconds ?? 0),
        ),
      open: async (oid: unknown) => {
        const o = core.repos.overlays.get(id.parse(oid));
        if (!o || !core.server.port) throw new Error('Overlay indisponible');
        await shell.openExternal(core.server.overlayUrl(o));
      },
    },
    account: {
      get: () => account.state(),
      register: (email: unknown, password: unknown) =>
        account.register(emailSchema.parse(email), passwordSchema.parse(password)),
      login: (email: unknown, password: unknown, replace: unknown) =>
        account.login(
          emailSchema.parse(email),
          z.string().min(1).max(200).parse(password),
          z.string().uuid().optional().parse(replace),
        ),
      logout: () => account.logout(),
      refresh: async () => {
        await account.refresh();
        return account.state();
      },
      upgrade: async (interval: unknown) => {
        const url = await account.checkoutUrl(z.enum(['monthly', 'yearly']).parse(interval));
        await shell.openExternal(url);
        account.watchUpgrade();
      },
      manageSubscription: async () => {
        await shell.openExternal(await account.portalUrl());
      },
      removeDevice: async (did: unknown) => {
        await account.removeDevice(z.string().uuid().parse(did));
        return account.state();
      },
      changePassword: (oldPassword: unknown, newPassword: unknown) =>
        account.changePassword(z.string().max(200).parse(oldPassword), passwordSchema.parse(newPassword)),
      deleteAccount: (password: unknown) => account.deleteAccount(z.string().min(1).max(200).parse(password)),
    },
    updates: {
      get: () => updater.get(),
      check: () => updater.check(),
      download: () => updater.download(),
      install: () => updater.install(),
      setAutoCheck: (on: unknown) => updater.setAutoCheck(z.boolean().parse(on)),
    },
    themes: {
      list: () => core.listThemes(),
      save: (name: unknown, style: unknown) =>
        core.saveTheme(z.string().trim().min(1).max(60).parse(name), OverlayStyleSchema.parse(style)),
      remove: (tid: unknown) => core.removeTheme(id.parse(tid)),
    },
    engine: {
      clearQueue: () => core.engine.clearQueue(),
      stats: () => core.engine.stats(),
    },
    journal: {
      recent: () => core.recentJournal(),
    },
    media: {
      ended: (mid: unknown) => core.media.ended(id.parse(mid)),
    },
    homeGames: {
      list: () => core.homeGames.list().map((g) => core.homeGames.dto(g)),
      addUrl: async (name: unknown, url: unknown) =>
        core.homeGames.dto(
          await core.homeGames.add({
            name: z.string().min(1).max(80).parse(name),
            url: z.string().url().max(500).parse(url),
          }),
        ),
      addFolder: async (name: unknown) => {
        const win = getWindow();
        const opts = {
          title: 'Dossier du jeu (contenant index.html)',
          properties: ['openDirectory' as const],
        };
        const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        const folder = res.filePaths[0];
        if (res.canceled || !folder) return null;
        return core.homeGames.dto(
          await core.homeGames.add({ name: z.string().min(1).max(80).parse(name), folder }),
        );
      },
      remove: (gid: unknown) => core.homeGames.remove(id.parse(gid)),
      open: (gid: unknown) => {
        const game = core.homeGames.get(id.parse(gid));
        if (!game || !core.server.port) throw new Error('Jeu introuvable');
        openGameWindow(game.name, core.homeGames.launchUrl(game));
      },
    },
    sounds: {
      list: () => core.repos.sounds.list().map(({ id: sid, name, volume }) => ({ id: sid, name, volume })),
      importFiles: async () => {
        const win = getWindow();
        const opts = {
          title: 'Importer des sons',
          properties: ['openFile' as const, 'multiSelections' as const],
          filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }],
        };
        const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        if (res.canceled) return [];
        const out = [];
        for (const f of res.filePaths.slice(0, 50)) {
          const snd = await core.importSound(f);
          out.push({ id: snd.id, name: snd.name, volume: snd.volume });
        }
        return out;
      },
      update: (sid: unknown, name: unknown, volume: unknown) =>
        core.repos.sounds.update(id.parse(sid), {
          name: z.string().min(1).max(80).parse(name),
          volume: z.number().min(0).max(1).parse(volume),
        }),
      remove: (sid: unknown) => core.removeSound(id.parse(sid)),
      play: (sid: unknown) => core.playSound(id.parse(sid)),
      getVolume: () => core.soundsVolume(),
      setVolume: (v: unknown) => core.setSoundsVolume(z.number().min(0).max(1).parse(v)),
    },
    tts: {
      get: () => core.ttsState(),
      update: (patch: unknown, key: unknown) =>
        core.updateTtsSettings(
          onlyGivenKeys(TtsSettingsSchema.partial().strict().parse(patch), patch),
          z.string().max(200).nullable().optional().parse(key),
        ),
      voices: () => core.ttsVoices(),
      test: (text: unknown) => {
        if (!core.tts.say(z.string().min(1).max(300).parse(text))) {
          throw new Error('Synthèse vocale désactivée, message filtré ou file pleine');
        }
      },
      skip: () => core.tts.skipAll(),
    },
    settings: {
      get: () => core.settings(),
      update: (patch: unknown) => core.updateSettings(SettingsPatchSchema.parse(patch)),
      regenerateApiToken: () => core.regenerateApiToken(),
    },
  } satisfies Handlers;

  ipcMain.handle('api', async (event: IpcMainInvokeEvent, ns: unknown, method: unknown, args: unknown) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents) throw new Error('Forbidden');
    if (typeof ns !== 'string' || typeof method !== 'string' || !Array.isArray(args))
      throw new Error('Bad request');
    if (!Object.hasOwn(handlers, ns)) throw new Error(`Unknown namespace ${ns}`);
    const group = handlers[ns as keyof typeof handlers] as Record<string, (...a: unknown[]) => unknown>;
    if (!Object.hasOwn(group, method)) throw new Error(`Unknown method ${ns}.${method}`);
    try {
      return await group[method]!(...args);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new Error(
          `Données invalides : ${err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`,
          { cause: err },
        );
      }
      throw err;
    }
  });
}
