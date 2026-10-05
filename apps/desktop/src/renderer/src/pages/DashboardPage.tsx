import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimulatorUser } from '../../../shared/api';
import { GiftSelect } from '../components/GiftSelect';
import { JournalLine } from '../components/JournalLine';
import { StatusBadge } from '../components/StatusBadge';
import { Button, Card, Empty, Field, Input, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useStore } from '../lib/store';

const fmt = new Intl.NumberFormat();

export function DashboardPage() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ConnectionCard />
      <StatsCard />
      <SimulatorCard />
      <div className="flex flex-col gap-4">
        <QueueCard />
        <RecentCard />
      </div>
    </div>
  );
}

function ConnectionCard() {
  const { t } = useTranslation();
  const connection = useStore((s) => s.connection);
  const settings = useStore((s) => s.settings);
  const [username, setUsername] = useState(settings?.tiktokUsername ?? '');
  const [connect, connecting] = useAction((u: string) => api.connection.connect(u));
  const [disconnect] = useAction(() => api.connection.disconnect());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const active = connection.status !== 'idle' && connection.status !== 'error';

  return (
    <Card title={t('dashboard.connection')} actions={<StatusBadge status={connection.status} />}>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!active) void connect(username);
        }}
      >
        <Field label={t('dashboard.username')} className="flex-1">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('dashboard.usernamePlaceholder')}
            disabled={active}
          />
        </Field>
        {active ? (
          <Button variant="secondary" onClick={() => void disconnect()}>
            {t('dashboard.disconnect')}
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={connecting || !username.trim()}>
            {t('dashboard.connect')}
          </Button>
        )}
      </form>
      {(connection.detail || connection.retryAt) && (
        <p className="mt-2 text-xs text-slate-400">
          {connection.detail}
          {connection.retryAt && connection.retryAt > now && (
            <> — {t('dashboard.retryIn', { s: Math.ceil((connection.retryAt - now) / 1000) })}</>
          )}
        </p>
      )}
    </Card>
  );
}

function StatsCard() {
  const { t } = useTranslation();
  const session = useStore((s) => s.session);
  const [reset] = useAction(() => api.session.reset());
  const stats = [
    ['likes', session.likes, '❤'],
    ['viewers', session.viewers, '👁'],
    ['diamonds', session.diamonds, '💎'],
    ['followers', session.followers, '➕'],
  ] as const;
  return (
    <Card
      title={t('dashboard.stats')}
      actions={
        <Button size="sm" variant="ghost" onClick={() => void reset()}>
          {t('dashboard.resetSession')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([key, value, icon]) => (
          <div key={key} className="rounded-lg bg-ink-850 p-3">
            <div className="text-xs text-slate-400">
              {icon} {t(`dashboard.${key}`)}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{fmt.format(value)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SimulatorCard() {
  const { t } = useTranslation();
  const gifts = useStore((s) => s.gifts);
  const [giftId, setGiftId] = useState('');
  const [count, setCount] = useState(1);
  const [username, setUsername] = useState('');
  const [isModerator, setModerator] = useState(false);
  const [isSubscriber, setSubscriber] = useState(false);
  const [chat, setChat] = useState('!tnt');
  const user: SimulatorUser = { ...(username ? { username } : {}), isModerator, isSubscriber };
  const [run] = useAction((fn: () => Promise<void>) => fn());

  useEffect(() => {
    if (!giftId && gifts[0]) setGiftId(gifts[0].id);
  }, [gifts, giftId]);

  return (
    <Card title={t('dashboard.simulator')}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('dashboard.simUser')} className="w-44">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('dashboard.simUserPlaceholder')}
            />
          </Field>
          <Toggle checked={isModerator} onChange={setModerator} label={t('dashboard.moderator')} />
          <Toggle checked={isSubscriber} onChange={setSubscriber} label={t('dashboard.subscriber')} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('dashboard.gift')} className="min-w-52 flex-1">
            <GiftSelect value={giftId} onChange={setGiftId} />
          </Field>
          <Field label={t('dashboard.count')} className="w-24">
            <Input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
          <Button
            variant="primary"
            disabled={!giftId}
            onClick={() => void run(() => api.simulator.gift(giftId, count, user))}
          >
            🎁 {t('dashboard.sendGift')}
          </Button>
        </div>
        {gifts.length === 0 && <p className="text-xs text-slate-500">{t('dashboard.noGifts')}</p>}
        <div className="flex flex-wrap gap-2">
          {[15, 100, 1000].map((n) => (
            <Button key={n} size="sm" onClick={() => void run(() => api.simulator.like(n, user))}>
              ❤ {t('dashboard.sendLikes', { n })}
            </Button>
          ))}
          <Button size="sm" onClick={() => void run(() => api.simulator.follow(user))}>
            ➕ {t('dashboard.follow')}
          </Button>
          <Button size="sm" onClick={() => void run(() => api.simulator.share(user))}>
            ↗ {t('dashboard.share')}
          </Button>
          <Button size="sm" onClick={() => void run(() => api.simulator.subscribe(user))}>
            ★ {t('dashboard.subscribe')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void run(() => api.simulator.rain(10))}>
            🌧 {t('dashboard.rain')}
          </Button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (chat.trim()) void run(() => api.simulator.chat(chat, user));
          }}
        >
          <Input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder={t('dashboard.chatPlaceholder')}
          />
          <Button type="submit">{t('dashboard.send')}</Button>
        </form>
      </div>
    </Card>
  );
}

function QueueCard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState({ pending: 0, running: 0 });
  const [clear] = useAction(() => api.engine.clearQueue());
  useEffect(() => {
    const tick = () =>
      void api.engine
        .stats()
        .then(setStats)
        .catch(() => undefined);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Card
      title={t('dashboard.queue')}
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void clear()}
          disabled={!stats.pending && !stats.running}
        >
          {t('dashboard.clearQueue')}
        </Button>
      }
    >
      <div className="flex gap-6 text-sm">
        <span>
          <b className="text-lg tabular-nums">{stats.running}</b> {t('dashboard.running')}
        </span>
        <span>
          <b className="text-lg tabular-nums">{stats.pending}</b> {t('dashboard.pending')}
        </span>
      </div>
    </Card>
  );
}

function RecentCard() {
  const { t } = useTranslation();
  const journal = useStore((s) => s.journal);
  const recent = journal.slice(-14).reverse();
  return (
    <Card title={t('dashboard.recent')} className="flex-1">
      {recent.length === 0 ? (
        <Empty>{t('journal.empty')}</Empty>
      ) : (
        <div>
          {recent.map((e, i) => (
            <JournalLine key={`${e.ts}-${i}`} entry={e} />
          ))}
        </div>
      )}
    </Card>
  );
}
