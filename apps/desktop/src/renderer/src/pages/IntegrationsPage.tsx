import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationDefinitionDto, IntegrationDto } from '../../../shared/api';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useCatalog } from '../lib/catalog';
import { useAction, useLoad } from '../lib/hooks';
import { useStore } from '../lib/store';
import { ProBadge } from '../components/ProBadge';
import { useEntitlements } from '../lib/store';
import { integrationAllowed } from '@toktok/shared';

const STATE_COLOR = { connected: 'green', connecting: 'yellow', disconnected: 'gray', error: 'red' } as const;

export function IntegrationsPage() {
  const { t } = useTranslation();
  const cat = useCatalog();
  const ent = useEntitlements();
  const version = useStore((s) => s.integrationsVersion);
  const [defs] = useLoad(() => api.integrations.definitions());
  const [list, reload] = useLoad(() => api.integrations.list(), [version]);
  const [pinFor, setPinFor] = useState<IntegrationDto | null>(null);
  const [editing, setEditing] = useState<{
    def: IntegrationDefinitionDto;
    current: IntegrationDto | null;
  } | null>(null);
  const [test] = useAction(async (id: string) => {
    await api.integrations.test(id);
    reload();
  });
  const [remove] = useAction(async (i: IntegrationDto) => {
    if (!confirm(t('common.confirmDelete', { name: i.name }))) return;
    await api.integrations.remove(i.id);
    reload();
  });

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('integrations.add')}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {defs?.map((d) => (
            <button
              key={d.kind}
              disabled={!integrationAllowed(ent, d.kind)}
              onClick={() => setEditing({ def: d, current: null })}
              className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-left transition-colors hover:border-brand-500 disabled:cursor-default disabled:opacity-60 disabled:hover:border-ink-700"
            >
              <div className="flex items-center gap-2 font-medium">
                {cat.kindName(d.kind, d.name)}
                {!integrationAllowed(ent, d.kind) && <ProBadge />}
              </div>
              <div className="mt-1 text-xs text-slate-400">{cat.kindDescription(d.kind, d.description)}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title={t('nav.integrations')}>
        {!list?.length ? (
          <Empty>{t('integrations.empty')}</Empty>
        ) : (
          <div className="divide-y divide-ink-800">
            {list.map((i) => {
              const def = defs?.find((d) => d.kind === i.kind);
              return (
                <div key={i.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-slate-500">
                      {def ? cat.kindName(def.kind, def.name) : i.kind}
                      {i.status.detail ? ` — ${i.status.detail}` : ''}
                    </div>
                  </div>
                  {i.locked && <ProBadge />}
                  <Badge color={i.enabled ? STATE_COLOR[i.status.state] : 'gray'}>
                    {i.enabled ? t(`integrations.states.${i.status.state}`) : '—'}
                  </Badge>
                  <Button size="sm" onClick={() => void test(i.id)} disabled={!i.enabled}>
                    {t('integrations.testConnection')}
                  </Button>
                  {i.kind === 'rooms' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i.status.state !== 'connected'}
                      onClick={() => setPinFor(i)}
                    >
                      🔑 {t('integrations.rooms.changePin')}
                    </Button>
                  )}
                  {def && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ def, current: i })}>
                      {t('common.edit')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void remove(i)}>
                    ✕
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {pinFor && (
        <PinModal
          integration={pinFor}
          onClose={() => setPinFor(null)}
          onDone={() => {
            setPinFor(null);
            reload();
          }}
        />
      )}
      {editing && (
        <IntegrationModal
          def={editing.def}
          current={editing.current}
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

function IntegrationModal({
  def,
  current,
  onClose,
  onSaved,
}: {
  def: IntegrationDefinitionDto;
  current: IntegrationDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const cat = useCatalog();
  const [name, setName] = useState(current?.name ?? cat.kindName(def.kind, def.name));
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of def.configFields) {
      if (f.secret) continue;
      v[f.key] = current?.config[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '');
    }
    return v;
  });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [save, busy] = useAction(async () => {
    const config: Record<string, unknown> = { ...values };
    for (const [k, v] of Object.entries(secrets)) if (v) config[k] = v;
    await api.integrations.save({
      ...(current ? { id: current.id } : {}),
      kind: def.kind,
      name,
      enabled,
      config,
    });
    onSaved();
  }, t('common.saved'));

  return (
    <Modal
      title={cat.kindName(def.kind, def.name)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-slate-400">{cat.kindDescription(def.kind, def.description)}</p>
        <Field label={t('integrations.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Toggle checked={enabled} onChange={setEnabled} label={t('common.enabled')} />
        {def.configFields.map((f) => {
          const label = t(f.label, { defaultValue: f.key });
          const hint = f.help ? t(f.help, { defaultValue: '' }) : undefined;
          if (f.secret) {
            const isSet = current?.secretsSet.includes(f.key);
            return (
              <Field key={f.key} label={label} hint={isSet ? `✓ ${t('integrations.secretSet')}` : hint}>
                <Input
                  type="password"
                  autoComplete="off"
                  value={secrets[f.key] ?? ''}
                  placeholder={isSet ? '••••••••' : ''}
                  onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              </Field>
            );
          }
          if (f.type === 'boolean') {
            return (
              <Toggle
                key={f.key}
                checked={Boolean(values[f.key])}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                label={label}
              />
            );
          }
          if (f.type === 'select') {
            return (
              <Field key={f.key} label={label} hint={hint}>
                <Select
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          }
          return (
            <Field key={f.key} label={label} hint={hint}>
              <Input
                type={f.type === 'number' ? 'number' : 'text'}
                min={f.min}
                max={f.max}
                value={String(values[f.key] ?? '')}
                onChange={(e) =>
                  setValues((s) => ({
                    ...s,
                    [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                  }))
                }
              />
            </Field>
          );
        })}
      </div>
    </Modal>
  );
}

function PinModal({
  integration,
  onClose,
  onDone,
}: {
  integration: IntegrationDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const valid = /^[\w-]{4,64}$/.test(pin) && pin === confirmPin;
  const [save, busy] = useAction(async () => {
    await api.integrations.changeRoomPin(integration.id, pin);
    onDone();
  }, t('integrations.rooms.pinChanged'));
  return (
    <Modal
      title={`🔑 ${t('integrations.rooms.changePin')} — ${t('integrations.rooms.room')} ${String(integration.config.room ?? '')}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-slate-400">{t('integrations.rooms.pinHelp')}</p>
        <Field label={t('integrations.rooms.newPin')}>
          <Input
            type="password"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </Field>
        <Field label={t('integrations.rooms.confirmPin')}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
