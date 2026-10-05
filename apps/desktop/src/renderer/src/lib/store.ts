import type { GiftInfo, JournalEntry } from '@toktok/shared';
import { create } from 'zustand';
import type { AppSettings, ConnectionInfo, SessionInfo } from '../../../shared/api';
import i18n from '../i18n';
import { api, onPush } from './api';

interface LiveState {
  connection: ConnectionInfo;
  session: SessionInfo;
  journal: JournalEntry[];
  journalPaused: boolean;
  settings: AppSettings | null;
  gifts: GiftInfo[];
  integrationsVersion: number;
  setSettings(s: AppSettings): void;
  reloadGifts(): Promise<void>;
  clearJournal(): void;
  setJournalPaused(p: boolean): void;
}

const MAX_JOURNAL = 1000;

export const useStore = create<LiveState>((set) => ({
  connection: { status: 'idle', channel: null },
  session: { sessionId: null, channel: null, likes: 0, viewers: 0, diamonds: 0, followers: 0 },
  journal: [],
  journalPaused: false,
  settings: null,
  gifts: [],
  integrationsVersion: 0,
  setSettings(s) {
    set({ settings: s });
    if (i18n.language !== s.language) void i18n.changeLanguage(s.language);
  },
  async reloadGifts() {
    set({ gifts: await api.gifts.list() });
  },
  clearJournal() {
    set({ journal: [] });
  },
  setJournalPaused(p) {
    set({ journalPaused: p });
  },
}));

/** Loads initial state and subscribes to push channels. Call once at startup. */
export async function initStore(): Promise<void> {
  const [connection, session, settings, journal] = await Promise.all([
    api.connection.get(),
    api.session.get(),
    api.settings.get(),
    api.journal.recent(),
  ]);
  useStore.setState({ connection, session, journal });
  useStore.getState().setSettings(settings);
  await useStore.getState().reloadGifts();

  onPush('connection', (c) => useStore.setState({ connection: c }));
  onPush('session', (s) => useStore.setState({ session: s }));
  onPush('integrations', () =>
    useStore.setState((st) => ({ integrationsVersion: st.integrationsVersion + 1 })),
  );
  onPush('journal', (entries) => {
    if (useStore.getState().journalPaused) return;
    useStore.setState((st) => {
      const next = st.journal.concat(entries);
      return { journal: next.length > MAX_JOURNAL ? next.slice(next.length - MAX_JOURNAL) : next };
    });
    // A gift we did not know yet may have been learned: refresh the picker lazily.
    if (entries.some((e) => e.kind === 'event' && e.event.type === 'gift')) {
      const known = new Set(useStore.getState().gifts.map((g) => g.id));
      if (entries.some((e) => e.kind === 'event' && e.event.type === 'gift' && !known.has(e.event.gift.id))) {
        void useStore.getState().reloadGifts();
      }
    }
  });
}
