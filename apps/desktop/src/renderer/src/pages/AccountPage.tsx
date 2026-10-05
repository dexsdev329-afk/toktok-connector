import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoginResult } from '../../../shared/api';
import { Badge, Button, Card, Field, Input, Modal } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useStore } from '../lib/store';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function AccountPage() {
  const account = useStore((s) => s.account);
  if (!account) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {account.loggedIn ? <AccountCard /> : <SignInCard />}
      <PlansCard />
      {account.loggedIn && <DevicesCard />}
      {account.loggedIn && <SecurityCard />}
    </div>
  );
}

function SignInCard() {
  const { t } = useTranslation();
  const account = useStore((s) => s.account)!;
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [limit, setLimit] = useState<Extract<LoginResult, { ok: false }> | null>(null);
  const [submit, busy] = useAction(async (replaceDevice?: string) => {
    const r =
      mode === 'register'
        ? await api.account.register(email, password)
        : await api.account.login(email, password, replaceDevice);
    if (!r.ok) setLimit(r);
    else setLimit(null);
  });
  const valid =
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    password.length >= (mode === 'register' ? 8 : 1) &&
    (mode === 'login' || password === confirm);

  return (
    <Card title={mode === 'login' ? t('account.signIn') : t('account.createAccount')}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void submit();
        }}
      >
        <Field label={t('account.email')}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label={t('account.password')}
          hint={mode === 'register' ? t('account.passwordHint') : undefined}
        >
          <Input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {mode === 'register' && (
          <Field label={t('account.confirmPassword')}>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!valid || busy}>
            {mode === 'login' ? t('account.signIn') : t('account.createAccount')}
          </Button>
          <button
            type="button"
            className="text-sm text-slate-400 underline-offset-2 hover:text-white hover:underline"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t('account.noAccount') : t('account.haveAccount')}
          </button>
        </div>
        {account.lastError && <p className="text-xs text-red-300">{account.lastError}</p>}
        <p className="text-xs text-slate-500">{t('account.privacy')}</p>
      </form>
      {limit && (
        <Modal title={t('account.deviceLimitTitle')} onClose={() => setLimit(null)}>
          <p className="mb-3 text-sm text-slate-300">{t('account.deviceLimitText')}</p>
          <div className="grid gap-2">
            {limit.devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg bg-ink-850 px-3 py-2">
                <div className="flex-1">
                  <div className="text-sm">{d.name}</div>
                  <div className="text-xs text-slate-500">
                    {t('account.lastSeen', { date: dateFmt.format(new Date(d.lastSeenAt)) })}
                  </div>
                </div>
                <Button size="sm" onClick={() => void submit(d.id)} disabled={busy}>
                  {t('account.replaceDevice')}
                </Button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function AccountCard() {
  const { t } = useTranslation();
  const account = useStore((s) => s.account)!;
  const [refresh, refreshing] = useAction(async () => {
    useStore.setState({ account: await api.account.refresh() });
  });
  const [logout] = useAction(() => api.account.logout());
  const [portal] = useAction(() => api.account.manageSubscription());
  const s = account.summary;
  const lic = account.license;
  return (
    <Card
      title={t('account.myAccount')}
      actions={
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
          ↻ {t('account.refresh')}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">{account.email}</span>
        <Badge color={account.plan === 'pro' ? 'green' : 'gray'}>
          {account.plan === 'pro' ? 'TokTok Pro' : t('account.free')}
        </Badge>
      </div>
      {s?.subscription && (
        <p className="mt-2 text-sm text-slate-400">
          {s.subscription.cancelAtPeriodEnd
            ? t('account.endsOn', { date: fmtDate(s.subscription.currentPeriodEnd) })
            : t('account.renewsOn', { date: fmtDate(s.subscription.currentPeriodEnd) })}
        </p>
      )}
      {s?.proGranted && account.plan === 'pro' && (
        <p className="mt-2 text-sm text-slate-400">
          {s.planUntil ? t('account.grantedUntil', { date: fmtDate(s.planUntil) }) : t('account.granted')}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {lic.status === 'valid'
          ? t('account.licenseValid', { date: dateFmt.format(new Date(lic.expiresAt)) })
          : t(`account.license.${lic.status}`)}
      </p>
      {account.lastError && <p className="mt-2 text-xs text-amber-300">{account.lastError}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {s?.subscription && (
          <Button size="sm" onClick={() => void portal()}>
            {t('account.manageSubscription')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void logout()}>
          {t('account.logout')}
        </Button>
      </div>
    </Card>
  );
}

const FEATURES = ['actions', 'overlays', 'integrations', 'kick', 'themes', 'tts'] as const;

function PlansCard() {
  const { t } = useTranslation();
  const account = useStore((s) => s.account)!;
  const [upgrade, busy] = useAction(
    (interval: 'monthly' | 'yearly') => api.account.upgrade(interval),
    t('account.checkoutOpened'),
  );
  const intervals = account.summary?.billing.intervals ?? [];
  const isPro = account.plan === 'pro';
  return (
    <Card title={t('account.plans')}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="py-1 font-medium" />
            <th className="py-1 font-medium">{t('account.free')}</th>
            <th className="py-1 font-medium text-brand-300">Pro</th>
          </tr>
        </thead>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f} className="border-t border-ink-800">
              <td className="py-1.5 pr-2 text-slate-300">{t(`account.features.${f}.label`)}</td>
              <td className="py-1.5 pr-2 text-slate-400">{t(`account.features.${f}.free`)}</td>
              <td className="py-1.5 text-slate-200">{t(`account.features.${f}.pro`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {account.devPro && <p className="mt-3 text-xs text-amber-300">{t('account.devPro')}</p>}
      {!isPro && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!account.loggedIn ? (
            <p className="text-sm text-slate-400">{t('account.signInToUpgrade')}</p>
          ) : intervals.length === 0 ? (
            <p className="text-sm text-slate-400">{t('account.billingSoon')}</p>
          ) : (
            intervals.map((i) => (
              <Button
                key={i}
                variant={i === 'yearly' ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => void upgrade(i)}
              >
                {t(`account.upgrade.${i}`)}
              </Button>
            ))
          )}
        </div>
      )}
      {!isPro && account.loggedIn && intervals.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">{t('account.stripeNote')}</p>
      )}
    </Card>
  );
}

function DevicesCard() {
  const { t } = useTranslation();
  const account = useStore((s) => s.account)!;
  const [remove] = useAction(async (id: string) => {
    useStore.setState({ account: await api.account.removeDevice(id) });
  });
  const devices = account.summary?.devices ?? [];
  return (
    <Card title={t('account.devices', { n: devices.length, max: account.summary?.maxDevices ?? 3 })}>
      <div className="divide-y divide-ink-800">
        {devices.map((d) => (
          <div key={d.id} className="flex items-center gap-3 py-2">
            <div className="flex-1">
              <div className="text-sm">
                {d.name}{' '}
                {d.current && <span className="text-xs text-brand-300">({t('account.thisDevice')})</span>}
              </div>
              <div className="text-xs text-slate-500">
                {t('account.lastSeen', { date: dateFmt.format(new Date(d.lastSeenAt)) })}
              </div>
            </div>
            {!d.current && (
              <Button size="sm" variant="ghost" onClick={() => void remove(d.id)}>
                {t('account.signOutDevice')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function SecurityCard() {
  const { t } = useTranslation();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [change, changing] = useAction(async () => {
    await api.account.changePassword(oldPassword, newPassword);
    setOld('');
    setNew('');
  }, t('account.passwordChanged'));
  const [del, busy] = useAction(async () => {
    await api.account.deleteAccount(deletePassword);
    setDeleting(false);
  }, t('account.deleted'));
  return (
    <Card title={t('account.security')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('account.currentPassword')}>
          <Input
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(e) => setOld(e.target.value)}
          />
        </Field>
        <Field label={t('account.newPassword')} hint={t('account.passwordHint')}>
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!oldPassword || newPassword.length < 8 || changing}
          onClick={() => void change()}
        >
          {t('account.changePassword')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
          {t('account.deleteAccount')}
        </Button>
      </div>
      {deleting && (
        <Modal
          title={t('account.deleteAccount')}
          onClose={() => setDeleting(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" disabled={!deletePassword || busy} onClick={() => void del()}>
                {t('account.deleteForever')}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-300">{t('account.deleteText')}</p>
          <Field label={t('account.password')}>
            <Input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function fmtDate(iso: string | null): string {
  return iso ? dateFmt.format(new Date(iso)) : '—';
}
