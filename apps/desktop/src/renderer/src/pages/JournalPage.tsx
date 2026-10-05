import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JournalLine } from '../components/JournalLine';
import { Button, Card, Empty, cx } from '../components/ui';
import { useStore } from '../lib/store';

type Filter = 'all' | 'event' | 'action' | 'system';

export function JournalPage() {
  const { t } = useTranslation();
  const journal = useStore((s) => s.journal);
  const paused = useStore((s) => s.journalPaused);
  const setPaused = useStore((s) => s.setJournalPaused);
  const clear = useStore((s) => s.clearJournal);
  const [filter, setFilter] = useState<Filter>('all');
  const entries = (filter === 'all' ? journal : journal.filter((e) => e.kind === filter))
    .slice(-500)
    .reverse();
  const labels: Record<Filter, string> = {
    all: t('journal.filterAll'),
    event: t('journal.filterEvents'),
    action: t('journal.filterActions'),
    system: t('journal.filterSystem'),
  };

  return (
    <Card
      title={
        <div className="flex gap-1">
          {(Object.keys(labels) as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cx(
                'rounded-md px-2.5 py-1 text-xs',
                filter === f ? 'bg-brand-500/20 text-white' : 'text-slate-400 hover:bg-ink-800',
              )}
            >
              {labels[f]}
            </button>
          ))}
        </div>
      }
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => setPaused(!paused)}>
            {paused ? `▶ ${t('journal.resume')}` : `⏸ ${t('journal.pause')}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('journal.clear')}
          </Button>
        </>
      }
    >
      {entries.length === 0 ? (
        <Empty>{t('journal.empty')}</Empty>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          {entries.map((e, i) => (
            <JournalLine key={`${e.ts}-${i}`} entry={e} />
          ))}
        </div>
      )}
    </Card>
  );
}
