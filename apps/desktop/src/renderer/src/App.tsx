import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from './components/StatusBadge';
import { Toasts, cx } from './components/ui';
import { useStore } from './lib/store';
import { ActionsPage } from './pages/ActionsPage';
import { DashboardPage } from './pages/DashboardPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { JournalPage } from './pages/JournalPage';
import { OverlaysPage } from './pages/OverlaysPage';
import { SettingsPage } from './pages/SettingsPage';

const PAGES = {
  dashboard: { icon: '◉', component: DashboardPage },
  actions: { icon: '⚡', component: ActionsPage },
  integrations: { icon: '🎮', component: IntegrationsPage },
  overlays: { icon: '▣', component: OverlaysPage },
  journal: { icon: '☰', component: JournalPage },
  settings: { icon: '⚙', component: SettingsPage },
} as const;
type PageKey = keyof typeof PAGES;

export function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageKey>('dashboard');
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
            </button>
          ))}
        </nav>
        <div className="border-t border-ink-800 p-3">
          <StatusBadge status={connection.status} />
          {connection.channel && (
            <div className="mt-1 truncate text-xs text-slate-500">@{connection.channel}</div>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <h1 className="mb-5 text-xl font-bold">{t(`nav.${page}`)}</h1>
        <Page />
      </main>
      <Toasts />
    </div>
  );
}
