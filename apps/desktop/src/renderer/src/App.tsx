import { useTranslation } from 'react-i18next';
import { StatusBadge } from './components/StatusBadge';
import { Toasts, cx } from './components/ui';
import { useStore, type PageKey } from './lib/store';
import { AccountPage } from './pages/AccountPage';
import { LIVE_PLATFORMS } from '../../shared/api';
import { MediaPlayer } from './components/MediaPlayer';
import { ActionsPage } from './pages/ActionsPage';
import { AudioPage } from './pages/AudioPage';
import { DashboardPage } from './pages/DashboardPage';
import { HomeGamesPage } from './pages/HomeGamesPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { JournalPage } from './pages/JournalPage';
import { OverlaysPage } from './pages/OverlaysPage';
import { SettingsPage } from './pages/SettingsPage';

const PAGES = {
  dashboard: { icon: '◉', component: DashboardPage },
  actions: { icon: '⚡', component: ActionsPage },
  integrations: { icon: '🎮', component: IntegrationsPage },
  overlays: { icon: '▣', component: OverlaysPage },
  audio: { icon: '🔊', component: AudioPage },
  games: { icon: '🕹', component: HomeGamesPage },
  journal: { icon: '☰', component: JournalPage },
  account: { icon: '👤', component: AccountPage },
  settings: { icon: '⚙', component: SettingsPage },
} as const satisfies Record<PageKey, unknown>;

export function App() {
  const { t } = useTranslation();
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const plan = useStore((s) => s.account?.plan);
  const connection = useStore((s) => s.connection);
  const Page = PAGES[page].component;

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <div className="px-4 pt-5 pb-4">
          <div className="text-lg leading-tight font-extrabold tracking-tight">
            <span className="text-brand-500">TokTok</span> Game
            <br />
            Connector <span className="text-cyan-glow">Live</span>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {(Object.keys(PAGES) as PageKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setPage(key)}
              className={cx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                page === key
                  ? 'bg-brand-500/15 text-white'
                  : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200',
              )}
            >
              <span className="w-5 text-center">{PAGES[key].icon}</span>
              {t(`nav.${key}`)}
              {key === 'account' && plan === 'pro' && (
                <span className="ml-auto rounded bg-brand-500/25 px-1.5 text-[10px] font-bold text-brand-300">
                  PRO
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="border-t border-ink-800 p-3">
          {LIVE_PLATFORMS.map((p) =>
            connection[p].status === 'idle' && p !== 'tiktok' ? null : (
              <div key={p} className="mb-1.5">
                <StatusBadge status={connection[p].status} />
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {p === 'kick' ? 'Kick' : 'TikTok'}
                  {connection[p].channel ? ` · @${connection[p].channel}` : ''}
                </div>
              </div>
            ),
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <h1 className="mb-5 text-xl font-bold">{t(`nav.${page}`)}</h1>
        <Page />
      </main>
      <Toasts />
      <MediaPlayer />
    </div>
  );
}
