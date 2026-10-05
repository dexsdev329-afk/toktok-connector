import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsPatch, UpdateState } from '../../../shared/api';
import { Badge, Button, Card, Field, Input, Select, Toggle } from '../components/ui';
import { LANGUAGES, type Language } from '../i18n';
import { api, onPush } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const reloadGifts = useStore((s) => s.reloadGifts);
  const [info] = useLoad(() => api.app.info());
  const [signKey, setSignKey] = useState('');
  const [update] = useAction(
    async (patch: SettingsPatch) => setSettings(await api.settings.update(patch)),
    t('common.saved'),
  );
  const [refresh, refreshing] = useAction(async () => {
    const n = await api.gifts.refresh();
    await reloadGifts();
    toast(t('settings.giftsRefreshed', { n }), 'success');
  });
  const [regen] = useAction(async () => setSettings(await api.settings.regenerateApiToken()));
  if (!settings) return null;

  const curl = `curl -X POST -H "Authorization: Bearer ${settings.apiToken}" ${info?.serverOrigin ?? 'http://127.0.0.1:' + settings.serverPort}/api/actions/<ACTION_ID>/trigger`;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title={t('settings.general')}>
        <Field label={t('settings.language')} className="w-56">
          <Select
            value={settings.language}
            onChange={(e) => void update({ language: e.target.value as Language })}
          >
            {Object.entries(LANGUAGES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {info && (
          <p className="mt-3 text-xs text-slate-500">
            {t('settings.dataDir')} : {info.dataDir} — v{info.version}
          </p>
        )}
      </Card>

      <UpdatesCard />

      <Card title={t('settings.gifts')}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('settings.streakMode')} className="w-80">
            <Select
              value={settings.streakMode}
              onChange={(e) => void update({ streakMode: e.target.value as 'end' | 'repeat' })}
            >
              <option value="end">{t('settings.streakEnd')}</option>
              <option value="repeat">{t('settings.streakRepeat')}</option>
            </Select>
          </Field>
          <Button onClick={() => void refresh()} disabled={refreshing}>
            ↻ {t('settings.refreshGifts')}
          </Button>
        </div>
      </Card>

      <Card title={t('settings.tiktok')}>
        <Field label={t('settings.signApiKey')} hint={t('settings.signApiKeyHelp')}>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={signKey}
              onChange={(e) => setSignKey(e.target.value)}
              placeholder={settings.hasSignApiKey ? '••••••••' : ''}
            />
            <Button
              variant="primary"
              disabled={!signKey.trim()}
              onClick={() => void update({ signApiKey: signKey }).then(() => setSignKey(''))}
            >
              {t('common.save')}
            </Button>
          </div>
        </Field>
        {settings.hasSignApiKey && (
          <div className="mt-2 flex items-center gap-2">
            <Badge color="green">{t('settings.keySet')}</Badge>
            <Button size="sm" variant="ghost" onClick={() => void update({ signApiKey: null })}>
              {t('settings.removeKey')}
            </Button>
          </div>
        )}
      </Card>

      <Card title={t('settings.engine')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.concurrency')}>
            <Input
              type="number"
              min={1}
              max={10}
              defaultValue={settings.engineConcurrency}
              onBlur={(e) => void update({ engineConcurrency: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('settings.maxPerSecond')}>
            <Input
              type="number"
              min={1}
              max={100}
              defaultValue={settings.engineMaxPerSecond}
              onBlur={(e) => void update({ engineMaxPerSecond: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('settings.server')}>
        <Field label={t('settings.port')} className="w-40">
          <Input
            type="number"
            min={1024}
            max={65535}
            defaultValue={settings.serverPort}
            onBlur={(e) => void update({ serverPort: Number(e.target.value) })}
          />
        </Field>
      </Card>

      <Card title={t('settings.streamDeck')}>
        <Field label={t('settings.apiToken')}>
          <div className="flex gap-2">
            <Input readOnly value={settings.apiToken} className="font-mono text-xs" />
            <Button onClick={() => void regen()}>{t('settings.regenerate')}</Button>
          </div>
        </Field>
        <p className="mt-3 text-xs text-slate-400">{t('settings.apiExample')}</p>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-ink-950 p-2 text-xs text-slate-300">{curl}</pre>
      </Card>
    </div>
  );
}

function UpdatesCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    void api.updates.get().then(setState);
    return onPush('updates', setState);
  }, []);
  const [check, checking] = useAction(async () => setState(await api.updates.check()));
  const [download] = useAction(() => api.updates.download());
  const [install] = useAction(() => api.updates.install());
  const [setAuto] = useAction(async (on: boolean) => setState(await api.updates.setAutoCheck(on)));
  if (!state) return null;
  const disabled = state.status === 'disabled';
  return (
    <Card title={t('updates.title')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">{t('updates.current', { v: state.currentVersion })}</span>
        <Badge
          color={
            state.status === 'available' || state.status === 'downloaded'
              ? 'green'
              : state.status === 'error'
                ? 'red'
                : 'gray'
          }
        >
          {t(`updates.status.${state.status}`, { v: state.version ?? '', p: state.percent ?? 0 })}
        </Badge>
      </div>
      {state.error && <p className="mt-2 text-xs text-red-300">{state.error}</p>}
      {state.notes && state.status === 'available' && (
        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-850 p-2 text-xs text-slate-300">
          {state.notes}
        </pre>
      )}
      {state.status === 'downloading' && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${state.percent ?? 0}%` }} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {state.status === 'available' ? (
          <Button variant="primary" onClick={() => void download()}>
            ⬇ {t('updates.download', { v: state.version })}
          </Button>
        ) : state.status === 'downloaded' ? (
          <Button variant="primary" onClick={() => void install()}>
            ↻ {t('updates.install')}
          </Button>
        ) : (
          <Button
            onClick={() => void check()}
            disabled={disabled || checking || state.status === 'checking' || state.status === 'downloading'}
          >
            {t('updates.check')}
          </Button>
        )}
        <Toggle checked={state.autoCheck} onChange={(v) => void setAuto(v)} label={t('updates.autoCheck')} />
      </div>
      {disabled && <p className="mt-2 text-xs text-slate-500">{t('updates.disabledHelp')}</p>}
    </Card>
  );
}
