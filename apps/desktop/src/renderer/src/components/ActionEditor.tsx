import type { Action, Effect, GiftInfo, Trigger, TriggerKind } from '@toktok/shared';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EffectDefinitionDto, IntegrationDefinitionDto, IntegrationDto } from '../../../shared/api';
import { api } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { GiftSelect } from './GiftSelect';
import { Button, Field, Input, Modal, Select, Textarea, Toggle } from './ui';

const TRIGGER_KINDS: TriggerKind[] = [
  'gift',
  'diamonds',
  'likes',
  'follow',
  'share',
  'subscribe',
  'command',
  'keyword',
];

function defaultTrigger(kind: TriggerKind): Trigger {
  switch (kind) {
    case 'gift':
      return { kind, giftId: '5655', minCount: 1 };
    case 'diamonds':
      return { kind, min: 100 };
    case 'likes':
      return { kind, every: 500 };
    case 'command':
      return { kind, name: 'tnt' };
    case 'keyword':
      return { kind, text: 'gg' };
    default:
      return { kind };
  }
}

export function triggerSummary(t: TFunction, trigger: Trigger, gifts: GiftInfo[]): string {
  switch (trigger.kind) {
    case 'gift':
      return t('triggers.summary.gift', {
        name: gifts.find((g) => g.id === trigger.giftId)?.name ?? trigger.giftId,
        min: trigger.minCount,
      });
    case 'diamonds':
      return trigger.max
        ? t('triggers.summary.diamondsRange', { min: trigger.min, max: trigger.max })
        : t('triggers.summary.diamonds', { min: trigger.min });
    case 'likes':
      return t('triggers.summary.likes', { every: trigger.every });
    case 'command':
      return t('triggers.summary.command', { name: trigger.name });
    case 'keyword':
      return t('triggers.summary.keyword', { text: trigger.text });
    default:
      return t(`triggers.${trigger.kind}`);
  }
}

type Draft = Omit<Action, 'id'> & { id?: string };

function newDraft(profileId: string): Draft {
  return {
    profileId,
    name: '',
    enabled: true,
    position: 0,
    trigger: defaultTrigger('gift'),
    effects: [],
    cooldownMs: 0,
    userCooldownMs: 0,
    priority: 5,
    busyPolicy: 'queue',
    quantityMode: 'once',
    maxMultiplier: 10,
    userFilter: {
      moderatorsOnly: false,
      subscribersOnly: false,
      followersOnly: false,
      allowList: [],
      denyList: [],
    },
    soundId: null,
    ttsTemplate: null,
  };
}

const num = (v: string, fallback = 0) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

export function ActionEditor({
  profileId,
  action,
  onClose,
  onSaved,
}: {
  profileId: string;
  action: Action | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => (action ? structuredClone(action) : newDraft(profileId)));
  const [defs] = useLoad(() => api.integrations.definitions());
  const [instances] = useLoad(() => api.integrations.list());
  const [sounds] = useLoad(() => api.sounds.list());
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const [save, busy] = useAction(async () => {
    await api.actions.save({ ...draft, name: draft.name.trim() || triggerSummary(t, draft.trigger, []) });
    onSaved();
  }, t('common.saved'));

  return (
    <Modal
      wide
      title={action ? action.name : t('actions.newAction')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label={t('actions.name')}>
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="TNT" />
        </Field>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-300">{t('actions.trigger')}</h4>
          <TriggerEditor trigger={draft.trigger} onChange={(trigger) => set({ trigger })} />
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-300">{t('actions.effects')}</h4>
          <EffectsEditor
            effects={draft.effects}
            defs={defs ?? []}
            instances={instances ?? []}
            onChange={(effects) => set({ effects })}
          />
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-300">{t('actions.options')}</h4>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t('actions.cooldownMs')}>
              <Input
                type="number"
                min={0}
                value={draft.cooldownMs}
                onChange={(e) => set({ cooldownMs: num(e.target.value) })}
              />
            </Field>
            <Field label={t('actions.userCooldownMs')}>
              <Input
                type="number"
                min={0}
                value={draft.userCooldownMs}
                onChange={(e) => set({ userCooldownMs: num(e.target.value) })}
              />
            </Field>
            <Field label={t('actions.priority')}>
              <Input
                type="number"
                min={0}
                max={10}
                value={draft.priority}
                onChange={(e) => set({ priority: num(e.target.value, 5) })}
              />
            </Field>
            <Field label={t('actions.busyPolicy')}>
              <Select
                value={draft.busyPolicy}
                onChange={(e) => set({ busyPolicy: e.target.value as Draft['busyPolicy'] })}
              >
                <option value="queue">{t('actions.busyQueue')}</option>
                <option value="skip">{t('actions.busySkip')}</option>
              </Select>
            </Field>
            <Field label={t('actions.quantityMode')} className="col-span-2">
              <Select
                value={draft.quantityMode}
                onChange={(e) => set({ quantityMode: e.target.value as Draft['quantityMode'] })}
              >
                <option value="once">{t('actions.quantityOnce')}</option>
                <option value="multiply">{t('actions.quantityMultiply')}</option>
              </Select>
            </Field>
            {draft.quantityMode === 'multiply' && (
              <Field label={t('actions.maxMultiplier')}>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.maxMultiplier}
                  onChange={(e) => set({ maxMultiplier: num(e.target.value, 10) })}
                />
              </Field>
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <Field label={`🔊 ${t('actions.sound')}`}>
            <Select value={draft.soundId ?? ''} onChange={(e) => set({ soundId: e.target.value || null })}>
              <option value="">{t('common.none')}</option>
              {sounds?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`🗣 ${t('actions.tts')}`}>
            <Input
              value={draft.ttsTemplate ?? ''}
              placeholder="{displayName} lance une TNT !"
              onChange={(e) => set({ ttsTemplate: e.target.value || null })}
            />
          </Field>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-slate-300">{t('actions.userFilter')}</h4>
          <div className="flex flex-wrap gap-4">
            {(['moderatorsOnly', 'subscribersOnly', 'followersOnly'] as const).map((k) => (
              <Toggle
                key={k}
                checked={draft.userFilter[k]}
                onChange={(v) => set({ userFilter: { ...draft.userFilter, [k]: v } })}
                label={t(`actions.${k}`)}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{t('actions.everyone')}</p>
          <Field label={t('actions.denyList')} className="mt-2">
            <Input
              value={draft.userFilter.denyList.join(', ')}
              onChange={(e) =>
                set({
                  userFilter: {
                    ...draft.userFilter,
                    denyList: e.target.value
                      .split(',')
                      .map((s) => s.trim().replace(/^@/, ''))
                      .filter(Boolean),
                  },
                })
              }
            />
          </Field>
        </section>
      </div>
    </Modal>
  );
}

function TriggerEditor({ trigger, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('actions.trigger')} className="w-56">
        <Select
          value={trigger.kind}
          onChange={(e) => onChange(defaultTrigger(e.target.value as TriggerKind))}
        >
          {TRIGGER_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`triggers.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      {trigger.kind === 'gift' && (
        <>
          <Field label={t('triggers.giftId')} className="min-w-64 flex-1">
            <GiftSelect value={trigger.giftId} onChange={(giftId) => onChange({ ...trigger, giftId })} />
          </Field>
          <Field label={t('triggers.minCount')} className="w-32">
            <Input
              type="number"
              min={1}
              value={trigger.minCount}
              onChange={(e) => onChange({ ...trigger, minCount: Math.max(1, num(e.target.value, 1)) })}
            />
          </Field>
        </>
      )}
      {trigger.kind === 'diamonds' && (
        <>
          <Field label={t('triggers.min')} className="w-40">
            <Input
              type="number"
              min={1}
              value={trigger.min}
              onChange={(e) => onChange({ ...trigger, min: Math.max(1, num(e.target.value, 1)) })}
            />
          </Field>
          <Field label={t('triggers.max')} className="w-40">
            <Input
              type="number"
              min={1}
              value={trigger.max ?? ''}
              placeholder="∞"
              onChange={(e) => {
                const { max: _old, ...rest } = trigger;
                const v = e.target.value === '' ? undefined : Math.max(1, num(e.target.value, 1));
                onChange(v === undefined ? rest : { ...rest, max: v });
              }}
            />
          </Field>
        </>
      )}
      {trigger.kind === 'likes' && (
        <Field label={t('triggers.every')} className="w-40">
          <Input
            type="number"
            min={1}
            value={trigger.every}
            onChange={(e) => onChange({ ...trigger, every: Math.max(1, num(e.target.value, 1)) })}
          />
        </Field>
      )}
      {trigger.kind === 'command' && (
        <Field label={t('triggers.commandName')} className="w-48">
          <Input
            value={trigger.name}
            onChange={(e) =>
              onChange({ ...trigger, name: e.target.value.replace(/^!/, '').replace(/\s/g, '') })
            }
          />
        </Field>
      )}
      {trigger.kind === 'keyword' && (
        <Field label={t('triggers.keywordText')} className="w-48">
          <Input value={trigger.text} onChange={(e) => onChange({ ...trigger, text: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

function EffectsEditor({
  effects,
  defs,
  instances,
  onChange,
}: {
  effects: Effect[];
  defs: IntegrationDefinitionDto[];
  instances: IntegrationDto[];
  onChange: (e: Effect[]) => void;
}) {
  const { t } = useTranslation();
  const defByKind = useMemo(() => new Map(defs.map((d) => [d.kind, d])), [defs]);
  const update = (i: number, patch: Partial<Effect>) =>
    onChange(effects.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const add = () => {
    const inst = instances[0];
    const effectDef = inst?.effects[0];
    if (!inst || !effectDef) return;
    onChange([...effects, newEffect(inst.id, effectDef)]);
  };

  if (!instances.length) return <p className="text-sm text-slate-500">{t('actions.noIntegration')}</p>;

  return (
    <div className="flex flex-col gap-3">
      {effects.map((effect, i) => {
        const inst = instances.find((x) => x.id === effect.integrationId);
        const def = inst ? defByKind.get(inst.kind) : undefined;
        const available = inst?.effects ?? def?.effects ?? [];
        const effectDef = available.find((e) => e.id === effect.effectId);
        return (
          <div key={i} className="rounded-lg border border-ink-700 bg-ink-850 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('actions.integration')} className="min-w-40 flex-1">
                <Select
                  value={effect.integrationId}
                  onChange={(e) => {
                    const ni = instances.find((x) => x.id === e.target.value);
                    const nd = ni?.effects[0];
                    if (ni && nd) update(i, newEffect(ni.id, nd));
                  }}
                >
                  {instances.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('actions.effect')} className="min-w-40 flex-1">
                <Select
                  value={effect.effectId}
                  onChange={(e) => {
                    const nd = available.find((x) => x.id === e.target.value);
                    if (nd) update(i, newEffect(effect.integrationId, nd));
                  }}
                >
                  {available.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {def && def.presets.length > 0 && (
                <Field label={t('actions.preset')} className="min-w-40 flex-1">
                  <Select
                    value=""
                    onChange={(e) => {
                      const p = def.presets.find((x) => x.id === e.target.value);
                      if (p) update(i, { effectId: p.effectId, params: { ...p.params } });
                    }}
                  >
                    <option value="">—</option>
                    {[...new Set(def.presets.map((p) => p.category))].map((cat) => (
                      <optgroup key={cat} label={cat}>
                        {def.presets
                          .filter((p) => p.category === cat)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                disabled={i === 0}
                onClick={() => onChange(swap(effects, i, i - 1))}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === effects.length - 1}
                onClick={() => onChange(swap(effects, i, i + 1))}
              >
                ↓
              </Button>
              <EffectTestButton effect={effect} />
              <Button size="sm" variant="ghost" onClick={() => onChange(effects.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
            {effectDef && (
              <div className="mt-3 grid gap-2">
                {effectDef.description && <p className="text-xs text-slate-500">{effectDef.description}</p>}
                {effectDef.params.map((p) => (
                  <Field key={p.key} label={t(p.label, { defaultValue: p.key })}>
                    <ParamInput
                      param={p}
                      value={effect.params[p.key]}
                      onChange={(v) => update(i, { params: { ...effect.params, [p.key]: v } })}
                    />
                  </Field>
                ))}
                <div className="grid grid-cols-3 gap-2">
                  <Field label={t('actions.delayMs')}>
                    <Input
                      type="number"
                      min={0}
                      value={effect.delayMs}
                      onChange={(e) => update(i, { delayMs: num(e.target.value) })}
                    />
                  </Field>
                  <Field label={t('actions.repeat')}>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={effect.repeat}
                      onChange={(e) => update(i, { repeat: Math.max(1, num(e.target.value, 1)) })}
                    />
                  </Field>
                  <Field label={t('actions.repeatIntervalMs')}>
                    <Input
                      type="number"
                      min={0}
                      value={effect.repeatIntervalMs}
                      onChange={(e) => update(i, { repeatIntervalMs: num(e.target.value) })}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button onClick={add}>＋ {t('actions.addEffect')}</Button>
        <span className="text-xs text-slate-500">{t('actions.variables')}</span>
      </div>
    </div>
  );
}

function EffectTestButton({ effect }: { effect: Effect }) {
  const { t } = useTranslation();
  const [run, busy] = useAction(() => api.actions.testEffect(effect), t('actions.effectTested'));
  return (
    <Button size="sm" onClick={() => void run()} disabled={busy} title={t('actions.testEffect')}>
      ▶
    </Button>
  );
}

type ParamDef = EffectDefinitionDto['params'][number];

/** Input for one effect parameter, according to its declared type. */
function ParamInput({
  param: p,
  value,
  onChange,
}: {
  param: ParamDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const current = value ?? p.default;
  switch (p.type) {
    case 'text':
      return (
        <Textarea
          rows={4}
          value={String(current ?? '')}
          placeholder={p.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          min={p.min}
          max={p.max}
          value={String(current ?? '')}
          onChange={(e) => onChange(num(e.target.value, Number(p.default ?? 0)))}
        />
      );
    case 'boolean':
      return <Toggle checked={current === true} onChange={onChange} label={t('common.yes')} />;
    case 'select':
      return (
        <Select value={String(current ?? '')} onChange={(e) => onChange(e.target.value)}>
          {p.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(`mcValues.${o.value}`, { defaultValue: o.label })}
            </option>
          ))}
        </Select>
      );
    default:
      return (
        <Input
          value={String(current ?? '')}
          placeholder={p.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function newEffect(integrationId: string, def: EffectDefinitionDto): Effect {
  const params: Record<string, unknown> = {};
  for (const p of def.params) if (p.default !== undefined) params[p.key] = p.default;
  return { integrationId, effectId: def.id, params, delayMs: 0, repeat: 1, repeatIntervalMs: 0 };
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const copy = [...arr];
  [copy[a], copy[b]] = [copy[b]!, copy[a]!];
  return copy;
}
