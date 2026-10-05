import type { OverlayKind } from '@toktok/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OverlayDto } from '../../../shared/api';
import { Button, Card, Field, Input, Modal, Select, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { toast } from '../lib/toast';

const KINDS: OverlayKind[] = ['alerts', 'top-donors', 'like-goal'];
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
      <div className="flex gap-2">
        {KINDS.map((k) => (
          <Button key={k} onClick={() => void add(k)}>
            ＋ {t(`overlays.kinds.${k}`)}
          </Button>
        ))}
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
            <span className="text-xs text-slate-500">{t('overlays.connected', { count: o.connected })}</span>
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
