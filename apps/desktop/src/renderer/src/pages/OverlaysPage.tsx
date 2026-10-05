import {
  OVERLAY_THEME_PRESETS,
  overlayAllowed,
  wheelSliceColor,
  type Action,
  type OverlayKind,
  type OverlayStyle,
  type WheelSegment,
} from '@toktok/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OverlayDto } from '../../../shared/api';
import { Button, Card, Field, Input, Modal, Select, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { toast } from '../lib/toast';
import { ProBadge } from '../components/ProBadge';
import { useEntitlements } from '../lib/store';

const KINDS: OverlayKind[] = [
  'alerts',
  'top-donors',
  'like-goal',
  'chat',
  'viewers',
  'recent-followers',
  'wheel',
  'timer',
];
const DEFAULT_STYLE: OverlayDto['style'] = {
  theme: 'default',
  primaryColor: '#ff2d75',
  textColor: '#ffffff',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSizePx: 28,
  animation: 'pop',
};

export function OverlaysPage() {
  const { t } = useTranslation();
  const ent = useEntitlements();
  const [list, reload] = useLoad(() => api.overlays.list());
  const [editing, setEditing] = useState<OverlayDto | null>(null);
  const [add] = useAction(async (kind: OverlayKind) => {
    await api.overlays.save({ kind, name: t(`overlays.kinds.${kind}`), style: DEFAULT_STYLE, options: {} });
    reload();
  });
  const [regen] = useAction(async (id: string) => {
    await api.overlays.regenerateToken(id);
    reload();
  }, t('overlays.regenerated'));
  const [open] = useAction((id: string) => api.overlays.open(id));
  const [remove] = useAction(async (o: OverlayDto) => {
    if (!confirm(t('common.confirmDelete', { name: o.name }))) return;
    await api.overlays.remove(o.id);
    reload();
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-400">{t('overlays.intro')}</p>
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) =>
          overlayAllowed(ent, k) ? (
            <Button key={k} onClick={() => void add(k)}>
              ＋ {t(`overlays.kinds.${k}`)}
            </Button>
          ) : (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-850 px-3 py-1.5 text-sm text-slate-500"
            >
              ＋ {t(`overlays.kinds.${k}`)} <ProBadge />
            </span>
          ),
        )}
      </div>
      {list?.map((o) => (
        <Card
          key={o.id}
          title={
            <>
              {o.name}{' '}
              <span className="ml-2 text-xs font-normal text-slate-500">{t(`overlays.kinds.${o.kind}`)}</span>
            </>
          }
          actions={
            o.locked ? (
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {t('account.overlayLocked')} <ProBadge />
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                {t('overlays.connected', { count: o.connected })}
              </span>
            )
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              value={o.url}
              className="min-w-80 flex-1 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                void navigator.clipboard.writeText(o.url).then(() => toast(t('common.copied'), 'success'))
              }
            >
              {t('common.copy')}
            </Button>
            <Button size="sm" onClick={() => void open(o.id)}>
              {t('common.open')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
              {t('common.edit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void regen(o.id)}>
              {t('overlays.regenerate')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove(o)}>
              ✕
            </Button>
          </div>
          <OverlayControls overlay={o} />
        </Card>
      ))}
      {editing && (
        <OverlayEditor
          overlay={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function OverlayEditor({
  overlay,
  onClose,
  onSaved,
}: {
  overlay: OverlayDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(overlay.name);
  const [style, setStyle] = useState(overlay.style);
  const [options, setOptions] = useState<Record<string, unknown>>(overlay.options);
  const [previewKey, setPreviewKey] = useState(0);
  const [save, busy] = useAction(async (close: boolean) => {
    await api.overlays.save({ id: overlay.id, kind: overlay.kind, name, style, options });
    setPreviewKey((k) => k + 1);
    if (close) onSaved();
  }, t('common.saved'));
  const opt = (key: string, fallback: unknown) => options[key] ?? fallback;
  const setOpt = (key: string, value: unknown) => setOptions((o) => ({ ...o, [key]: value }));

  return (
    <Modal
      wide
      title={overlay.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => void save(false)} disabled={busy}>
            {t('overlays.preview')} ↻
          </Button>
          <Button variant="primary" onClick={() => void save(true)} disabled={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <Field label={t('integrations.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ThemePicker style={style} setStyle={setStyle} />
          <h4 className="text-sm font-semibold text-slate-300">{t('overlays.style')}</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('overlays.theme')}>
              <Select
                value={style.theme}
                onChange={(e) => setStyle({ ...style, theme: e.target.value as typeof style.theme })}
              >
                {(['default', 'neon', 'minimal'] as const).map((th) => (
                  <option key={th} value={th}>
                    {t(`overlays.themes.${th}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('overlays.animation')}>
              <Select
                value={style.animation}
                onChange={(e) => setStyle({ ...style, animation: e.target.value as typeof style.animation })}
              >
                {(['pop', 'slide', 'fade', 'none'] as const).map((a) => (
                  <option key={a} value={a}>
                    {t(`overlays.animations.${a}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('overlays.primaryColor')}>
              <input
                type="color"
                value={style.primaryColor}
                onChange={(e) => setStyle({ ...style, primaryColor: e.target.value })}
                className="h-9 w-full rounded-lg bg-transparent"
              />
            </Field>
            <Field label={t('overlays.textColor')}>
              <input
                type="color"
                value={style.textColor}
                onChange={(e) => setStyle({ ...style, textColor: e.target.value })}
                className="h-9 w-full rounded-lg bg-transparent"
              />
            </Field>
            <Field label={t('overlays.font')}>
              <Input
                value={style.fontFamily}
                onChange={(e) => setStyle({ ...style, fontFamily: e.target.value })}
              />
            </Field>
            <Field label={t('overlays.fontSize')}>
              <Input
                type="number"
                min={10}
                max={96}
                value={style.fontSizePx}
                onChange={(e) => setStyle({ ...style, fontSizePx: Number(e.target.value) || 28 })}
              />
            </Field>
          </div>
          <AdvancedStyle style={style} setStyle={setStyle} />
          <h4 className="text-sm font-semibold text-slate-300">{t('actions.options')}</h4>
          {overlay.kind === 'alerts' && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('overlays.minDiamonds')}>
                  <Input
                    type="number"
                    min={0}
                    value={String(opt('minDiamonds', 1))}
                    onChange={(e) => setOpt('minDiamonds', Number(e.target.value) || 0)}
                  />
                </Field>
                <Field label={t('overlays.durationMs')}>
                  <Input
                    type="number"
                    min={1000}
                    max={30000}
                    value={String(opt('durationMs', 5000))}
                    onChange={(e) => setOpt('durationMs', Number(e.target.value) || 5000)}
                  />
                </Field>
              </div>
              <Toggle
                checked={Boolean(opt('showFollows', true))}
                onChange={(v) => setOpt('showFollows', v)}
                label={t('overlays.showFollows')}
              />
              <Toggle
                checked={Boolean(opt('showShares', false))}
                onChange={(v) => setOpt('showShares', v)}
                label={t('overlays.showShares')}
              />
              <Toggle
                checked={Boolean(opt('showSubscribes', true))}
                onChange={(v) => setOpt('showSubscribes', v)}
                label={t('overlays.showSubscribes')}
              />
            </div>
          )}
          {overlay.kind === 'top-donors' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('overlays.title')}>
                <Input
                  value={String(opt('title', 'Top donateurs'))}
                  onChange={(e) => setOpt('title', e.target.value)}
                />
              </Field>
              <Field label={t('overlays.limit')}>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={String(opt('limit', 5))}
                  onChange={(e) => setOpt('limit', Number(e.target.value) || 5)}
                />
              </Field>
            </div>
          )}
          {overlay.kind === 'like-goal' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('overlays.title')} className="col-span-2">
                <Input
                  value={String(opt('title', 'Objectif likes'))}
                  onChange={(e) => setOpt('title', e.target.value)}
                />
              </Field>
              <Field label={t('overlays.goal')}>
                <Input
                  type="number"
                  min={1}
                  value={String(opt('goal', 10000))}
                  onChange={(e) => setOpt('goal', Number(e.target.value) || 1)}
                />
              </Field>
              <Field label={t('overlays.autoIncrement')}>
                <Input
                  type="number"
                  min={0}
                  value={String(opt('autoIncrement', 0))}
                  onChange={(e) => setOpt('autoIncrement', Number(e.target.value) || 0)}
                />
              </Field>
            </div>
          )}
          {overlay.kind === 'chat' && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('overlays.maxMessages')}>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={String(opt('maxMessages', 8))}
                    onChange={(e) => setOpt('maxMessages', Number(e.target.value) || 8)}
                  />
                </Field>
                <Field label={t('overlays.fadeAfterSec')}>
                  <Input
                    type="number"
                    min={0}
                    max={600}
                    value={String(opt('fadeAfterSec', 0))}
                    onChange={(e) => setOpt('fadeAfterSec', Number(e.target.value) || 0)}
                  />
                </Field>
              </div>
              {(
                [
                  ['hideCommands', true],
                  ['showPlatform', true],
                  ['showAvatars', true],
                ] as const
              ).map(([k, d]) => (
                <Toggle
                  key={k}
                  checked={Boolean(opt(k, d))}
                  onChange={(v) => setOpt(k, v)}
                  label={t(`overlays.${k}`)}
                />
              ))}
            </div>
          )}
          {overlay.kind === 'viewers' && (
            <div className="grid gap-3">
              <Field label={t('overlays.label')}>
                <Input
                  value={String(opt('label', t('overlays.defaults.viewers')))}
                  onChange={(e) => setOpt('label', e.target.value)}
                />
              </Field>
              <Toggle
                checked={Boolean(opt('showLikes', false))}
                onChange={(v) => setOpt('showLikes', v)}
                label={t('overlays.showLikes')}
              />
            </div>
          )}
          {overlay.kind === 'recent-followers' && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('overlays.title')}>
                  <Input
                    value={String(opt('title', t('overlays.defaults.followers')))}
                    onChange={(e) => setOpt('title', e.target.value)}
                  />
                </Field>
                <Field label={t('overlays.limitUsers')}>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={String(opt('limit', 5))}
                    onChange={(e) => setOpt('limit', Number(e.target.value) || 5)}
                  />
                </Field>
              </div>
              <Toggle
                checked={Boolean(opt('includeSubscribers', true))}
                onChange={(v) => setOpt('includeSubscribers', v)}
                label={t('overlays.includeSubscribers')}
              />
            </div>
          )}
          {overlay.kind === 'timer' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('overlays.title')}>
                <Input
                  value={String(opt('title', 'Subathon'))}
                  onChange={(e) => setOpt('title', e.target.value)}
                />
              </Field>
              <Field label={t('overlays.endText')}>
                <Input
                  value={String(opt('endText', t('overlays.defaults.endText')))}
                  onChange={(e) => setOpt('endText', e.target.value)}
                />
              </Field>
              <Field label={t('overlays.initialMinutes')}>
                <Input
                  type="number"
                  min={0}
                  value={String(Number(opt('initialSeconds', 600)) / 60)}
                  onChange={(e) => setOpt('initialSeconds', Math.round((Number(e.target.value) || 0) * 60))}
                />
              </Field>
              <Field label={t('overlays.maxMinutes')}>
                <Input
                  type="number"
                  min={0}
                  value={String(Number(opt('maxSeconds', 0)) / 60)}
                  onChange={(e) => setOpt('maxSeconds', Math.round((Number(e.target.value) || 0) * 60))}
                />
              </Field>
              <p className="col-span-2 text-xs text-slate-500">{t('overlays.timerHelp')}</p>
            </div>
          )}
          {overlay.kind === 'wheel' && <WheelOptions options={options} setOpt={setOpt} />}
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-300">{t('overlays.preview')}</h4>
          <div className="overflow-hidden rounded-lg border border-ink-700 bg-[repeating-conic-gradient(#1d1d31_0%_25%,#12121f_0%_50%)] bg-[length:24px_24px]">
            {overlay.url && (
              <iframe key={previewKey} src={overlay.url} title="preview" className="h-80 w-full" />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const DEFAULT_SEGMENTS: WheelSegment[] = [
  { label: 'Zombie', weight: 1 },
  { label: 'TNT', weight: 1 },
  { label: 'Diamants', weight: 1 },
  { label: 'Rien', weight: 1 },
  { label: 'Creeper', weight: 1 },
  { label: 'Soin', weight: 1 },
];

function WheelOptions({
  options,
  setOpt,
}: {
  options: Record<string, unknown>;
  setOpt: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const segments = (options.segments as WheelSegment[] | undefined) ?? DEFAULT_SEGMENTS;
  const [actions] = useLoad(async (): Promise<Action[]> => {
    const active = (await api.profiles.list()).find((p) => p.isActive);
    return active ? api.actions.list(active.id) : [];
  });
  const setSeg = (i: number, patch: Partial<WheelSegment>) =>
    setOpt(
      'segments',
      segments.map((s, j) => {
        if (j !== i) return s;
        const next: WheelSegment = { ...s, ...patch };
        if (!next.actionId) delete next.actionId;
        if (!next.color) delete next.color;
        return next;
      }),
    );
  const total = segments.reduce((n, s) => n + (s.weight || 0), 0) || 1;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('overlays.title')}>
          <Input
            value={String(options.title ?? t('overlays.defaults.wheel'))}
            onChange={(e) => setOpt('title', e.target.value)}
          />
        </Field>
        <Field label={t('overlays.spinSeconds')}>
          <Input
            type="number"
            min={2}
            max={20}
            value={String(Number(options.spinMs ?? 6000) / 1000)}
            onChange={(e) => setOpt('spinMs', Math.round((Number(e.target.value) || 6) * 1000))}
          />
        </Field>
      </div>
      <Toggle
        checked={Boolean(options.hideWhenIdle ?? false)}
        onChange={(v) => setOpt('hideWhenIdle', v)}
        label={t('overlays.hideWhenIdle')}
      />
      <div className="text-xs text-slate-400">{t('overlays.segmentsHelp')}</div>
      <div className="grid gap-1.5">
        {segments.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_2.5rem_4rem_1fr_auto] items-center gap-1.5">
            <Input
              value={s.label}
              maxLength={40}
              onChange={(e) => setSeg(i, { label: e.target.value })}
              placeholder={t('overlays.segmentLabel')}
            />
            <input
              type="color"
              title={t('overlays.segmentColor')}
              value={s.color ?? wheelSliceColor(i, segments.length)}
              onChange={(e) => setSeg(i, { color: e.target.value })}
              className="h-8 w-full rounded bg-transparent"
            />
            <Input
              type="number"
              min={0.1}
              step={0.5}
              title={`${Math.round(((s.weight || 0) / total) * 100)} %`}
              value={String(s.weight)}
              onChange={(e) => setSeg(i, { weight: Math.max(0.1, Number(e.target.value) || 1) })}
            />
            <Select value={s.actionId ?? ''} onChange={(e) => setSeg(i, { actionId: e.target.value })}>
              <option value="">{t('overlays.noAction')}</option>
              {actions?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="ghost"
              disabled={segments.length <= 2}
              onClick={() =>
                setOpt(
                  'segments',
                  segments.filter((_, j) => j !== i),
                )
              }
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button
        size="sm"
        disabled={segments.length >= 24}
        onClick={() =>
          setOpt('segments', [
            ...segments,
            { label: t('overlays.segmentN', { n: segments.length + 1 }), weight: 1 },
          ])
        }
      >
        ＋ {t('overlays.addSegment')}
      </Button>
    </div>
  );
}

/** Manual buttons for interactive overlays (also usable live from the app). */
function OverlayControls({ overlay }: { overlay: OverlayDto }) {
  const { t } = useTranslation();
  const [spin] = useAction(() => api.overlays.spinWheel(overlay.id));
  const [timer] = useAction((op: 'toggle' | 'reset' | 'add', seconds?: number) =>
    api.overlays.timer(overlay.id, op, seconds),
  );
  if (overlay.kind === 'wheel') {
    return (
      <div className="mt-3">
        <Button size="sm" variant="primary" onClick={() => void spin()}>
          🎡 {t('overlays.spin')}
        </Button>
      </div>
    );
  }
  if (overlay.kind === 'timer') {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => void timer('toggle')}>
          ⏯ {t('overlays.startPause')}
        </Button>
        <Button size="sm" onClick={() => void timer('add', 60)}>
          +1 min
        </Button>
        <Button size="sm" onClick={() => void timer('add', -60)}>
          −1 min
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void timer('reset')}>
          ↺ {t('overlays.reset')}
        </Button>
      </div>
    );
  }
  return null;
}

/** Saved themes: presets, user themes, save / apply to all. */
function ThemePicker({ style, setStyle }: { style: OverlayStyle; setStyle: (s: OverlayStyle) => void }) {
  const { t } = useTranslation();
  const { themeEditor } = useEntitlements();
  const [themes, reload] = useLoad(() => api.themes.list());
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [save] = useAction(async () => {
    const theme = await api.themes.save(name.trim(), style);
    setName('');
    setSelected(theme.id);
    reload();
  }, t('overlays.themeSaved'));
  const [remove] = useAction(async (id: string) => {
    await api.themes.remove(id);
    setSelected('');
    reload();
  });
  const [applyAll] = useAction(async () => {
    if (!confirm(t('overlays.applyAllConfirm'))) return;
    await api.overlays.applyStyleToAll(style);
  }, t('overlays.appliedAll'));
  const all = [...OVERLAY_THEME_PRESETS, ...(themes ?? [])];
  const isCustom = themes?.some((th) => th.id === selected);
  return (
    <fieldset
      disabled={!themeEditor}
      className="grid gap-2 rounded-lg border border-ink-700 bg-ink-850 p-3 disabled:opacity-60"
    >
      {!themeEditor && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ProBadge /> {t('account.features.themes.label')}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Field label={t('overlays.savedThemes')} className="flex-1">
          <Select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const theme = all.find((th) => th.id === e.target.value);
              if (theme) setStyle({ ...theme.style });
            }}
          >
            <option value="">—</option>
            <optgroup label={t('overlays.presets')}>
              {OVERLAY_THEME_PRESETS.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </optgroup>
            {!!themes?.length && (
              <optgroup label={t('overlays.myThemes')}>
                {themes.map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        {isCustom && (
          <Button size="sm" variant="ghost" onClick={() => void remove(selected)} title={t('common.delete')}>
            🗑
          </Button>
        )}
      </div>
      <div className="flex items-end gap-2">
        <Field label={t('overlays.saveAsTheme')} className="flex-1">
          <Input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('overlays.themeName')}
          />
        </Field>
        <Button size="sm" disabled={!name.trim()} onClick={() => void save()}>
          💾
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={() => void applyAll()}>
        {t('overlays.applyAll')}
      </Button>
    </fieldset>
  );
}

/** Theme editor: fine-grained card look on top of the base theme. */
function AdvancedStyle({ style, setStyle }: { style: OverlayStyle; setStyle: (s: OverlayStyle) => void }) {
  const { t } = useTranslation();
  const { themeEditor } = useEntitlements();
  const set = (patch: Partial<OverlayStyle>) => setStyle({ ...style, ...patch });
  const clear = () => {
    const next = { ...style };
    for (const k of [
      'cardColor',
      'cardOpacity',
      'radiusPx',
      'borderWidthPx',
      'shadow',
      'textOutline',
    ] as const) {
      delete next[k];
    }
    setStyle(next);
  };
  return (
    <details className="rounded-lg border border-ink-700 p-3" open={style.cardColor !== undefined}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-300">
        {t('overlays.advanced')} {!themeEditor && <ProBadge className="ml-2" />}
      </summary>
      <fieldset disabled={!themeEditor} className="disabled:opacity-60">
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={t('overlays.cardColor')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={style.cardColor ?? '#0a0a14'}
                onChange={(e) => set({ cardColor: e.target.value })}
                className="h-9 w-12 rounded-lg bg-transparent"
              />
              <input
                type="range"
                min={0}
                max={100}
                value={style.cardOpacity ?? 72}
                onChange={(e) =>
                  set({ cardColor: style.cardColor ?? '#0a0a14', cardOpacity: Number(e.target.value) })
                }
                className="flex-1 accent-brand-500"
                title={`${style.cardOpacity ?? 72} %`}
              />
            </div>
          </Field>
          <Field label={t('overlays.shadow')}>
            <Select
              value={style.shadow ?? ''}
              onChange={(e) => {
                const v = e.target.value as OverlayStyle['shadow'] | '';
                const next = { ...style };
                if (v) next.shadow = v;
                else delete next.shadow;
                setStyle(next);
              }}
            >
              <option value="">{t('overlays.fromTheme')}</option>
              <option value="none">{t('overlays.shadows.none')}</option>
              <option value="soft">{t('overlays.shadows.soft')}</option>
              <option value="glow">{t('overlays.shadows.glow')}</option>
            </Select>
          </Field>
          <Field label={`${t('overlays.radius')} (${style.radiusPx ?? '—'} px)`}>
            <input
              type="range"
              min={0}
              max={48}
              value={style.radiusPx ?? 18}
              onChange={(e) => set({ radiusPx: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </Field>
          <Field label={`${t('overlays.borderWidth')} (${style.borderWidthPx ?? '—'} px)`}>
            <input
              type="range"
              min={0}
              max={8}
              value={style.borderWidthPx ?? 2}
              onChange={(e) => set({ borderWidthPx: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </Field>
          <Toggle
            checked={Boolean(style.textOutline)}
            onChange={(v) => set({ textOutline: v })}
            label={t('overlays.textOutline')}
          />
          <Button size="sm" variant="ghost" onClick={clear}>
            ↺ {t('overlays.fromTheme')}
          </Button>
        </div>
      </fieldset>
    </details>
  );
}
