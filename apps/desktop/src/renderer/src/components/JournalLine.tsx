import type { JournalEntry, LiveEvent } from '@toktok/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './ui';

const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour12: false });

export function useEventText() {
  const { t } = useTranslation();
  return (e: LiveEvent): string => {
    const user = 'user' in e ? e.user.displayName || e.user.username : '';
    switch (e.type) {
      case 'gift':
        return t('events.gift', {
          user,
          count: e.count,
          gift: e.gift.name,
          diamonds: e.gift.diamonds * e.count,
          unit: e.platform === 'kick' ? 'Kicks' : '💎',
        });
      case 'like':
        return t('events.like', { user, count: e.count });
      case 'chat':
        return t('events.chat', { user, text: e.text });
      case 'viewerCount':
        return t('events.viewerCount', { count: e.count });
      case 'connected':
        return t('events.connected', { channel: e.channel });
      case 'disconnected':
        return e.liveEnded ? t('events.liveEnded') : t('events.disconnected', { reason: e.reason ?? '' });
      default:
        return t(`events.${e.type}`, { user });
    }
  };
}

const EVENT_COLORS: Partial<Record<LiveEvent['type'], string>> = {
  gift: 'text-brand-400',
  follow: 'text-cyan-glow',
  subscribe: 'text-amber-300',
  connected: 'text-emerald-300',
  disconnected: 'text-red-300',
};

export function JournalLine({ entry }: { entry: JournalEntry }) {
  const { t } = useTranslation();
  const eventText = useEventText();
  let body: ReactNode;
  if (entry.kind === 'event') {
    body = (
      <span className={cx(EVENT_COLORS[entry.event.type] ?? 'text-slate-300')}>{eventText(entry.event)}</span>
    );
  } else if (entry.kind === 'action') {
    const color =
      entry.status === 'failed'
        ? 'text-red-300'
        : entry.status === 'done'
          ? 'text-emerald-300'
          : entry.status === 'skipped'
            ? 'text-amber-300'
            : 'text-slate-400';
    body = (
      <span className={color}>
        ⚡ {entry.actionName} — {t(`journal.statuses.${entry.status}`)}
        {entry.detail ? ` (${entry.detail})` : ''}
      </span>
    );
  } else {
    body = (
      <span
        className={
          entry.level === 'error'
            ? 'text-red-300'
            : entry.level === 'warn'
              ? 'text-amber-300'
              : 'text-slate-400'
        }
      >
        ⓘ {entry.message}
      </span>
    );
  }
  return (
    <div className="flex gap-3 py-0.5 font-mono text-xs">
      <span className="shrink-0 text-slate-600">{time(entry.ts)}</span>
      <span className="min-w-0 break-words">{body}</span>
    </div>
  );
}
