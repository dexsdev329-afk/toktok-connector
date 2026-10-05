import type { Action, Profile } from '@toktok/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionEditor, triggerSummary } from '../components/ActionEditor';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';

export function ActionsPage() {
  const { t } = useTranslation();
  const [profiles, reloadProfiles] = useLoad(() => api.profiles.list());
  const [selectedId, setSelectedId] = useState<string>('');
  const [profileModal, setProfileModal] = useState<Profile | 'new' | null>(null);
  const [packModal, setPackModal] = useState(false);

  // Default to the active profile. A freshly created/imported profile may not be in the
  // (asynchronously reloaded) list yet, so only fall back when nothing is selected.
  useEffect(() => {
    if (!profiles?.length || selectedId) return;
    setSelectedId((profiles.find((p) => p.isActive) ?? profiles[0]!).id);
  }, [profiles, selectedId]);

  const selected = profiles?.find((p) => p.id === selectedId);
  const [activate] = useAction(async (id: string) => {
    await api.profiles.activate(id);
    reloadProfiles();
  });
  const [remove] = useAction(async (p: Profile) => {
    if (!confirm(t('common.confirmDelete', { name: p.name }))) return;
    await api.profiles.remove(p.id);
    setSelectedId('');
    reloadProfiles();
  });
  const [exportProfile] = useAction(async (id: string) => {
    if (await api.profiles.exportToFile(id)) toast(t('actions.exported'), 'success');
  });
  const [importProfile] = useAction(async () => {
    const p = await api.profiles.importFromFile();
    if (p) {
      toast(t('actions.imported'), 'success');
      reloadProfiles();
      setSelectedId(p.id);
    }
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('actions.profile')} className="w-64">
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.game ? ` — ${p.game}` : ''}
                  {p.isActive ? ' ✓' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {selected &&
            (selected.isActive ? (
              <Badge color="green">{t('actions.active')}</Badge>
            ) : (
              <Button variant="primary" onClick={() => void activate(selected.id)}>
                {t('actions.activate')}
              </Button>
            ))}
          <div className="flex-1" />
          <Button onClick={() => setProfileModal('new')}>＋ {t('actions.newProfile')}</Button>
          {selected && (
            <>
              <Button variant="ghost" onClick={() => setProfileModal(selected)}>
                {t('common.edit')}
              </Button>
              <Button variant="ghost" onClick={() => void exportProfile(selected.id)}>
                {t('actions.export')}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => void importProfile()}>
            {t('actions.import')}
          </Button>
          <Button variant="ghost" onClick={() => setPackModal(true)}>
            🧱 {t('actions.minecraftPack')}
          </Button>
          {selected && profiles && profiles.length > 1 && (
            <Button variant="ghost" onClick={() => void remove(selected)}>
              {t('common.delete')}
            </Button>
          )}
        </div>
      </Card>
      {selected && <ActionList profile={selected} />}
      {packModal && (
        <MinecraftPackModal
          onClose={() => setPackModal(false)}
          onCreated={(p) => {
            setPackModal(false);
            reloadProfiles();
            setSelectedId(p.id);
          }}
        />
      )}
      {profileModal && (
        <ProfileModal
          profile={profileModal === 'new' ? null : profileModal}
          onClose={() => setProfileModal(null)}
          onSaved={(p) => {
            setProfileModal(null);
            reloadProfiles();
            setSelectedId(p.id);
          }}
        />
      )}
    </div>
  );
}

function MinecraftPackModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Profile) => void;
}) {
  const { t } = useTranslation();
  const [integrations] = useLoad(() => api.integrations.list());
  const minecraft = (integrations ?? []).filter(
    (i) => i.kind === 'minecraft-rcon' || i.kind === 'minecraft-bedrock',
  );
  const [choice, setChoice] = useState('');
  const selected = choice || minecraft[0]?.id || '';
  const [create, busy] = useAction(async () => {
    const p = await api.profiles.createMinecraftPack(selected);
    onCreated(p);
  }, t('actions.minecraftPackCreated'));
  return (
    <Modal
      title={`🧱 ${t('actions.minecraftPack')}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !selected} onClick={() => void create()}>
            {t('common.add')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-400">{t('actions.minecraftPackIntro')}</p>
      {minecraft.length === 0 ? (
        <p className="text-sm text-amber-300">{t('actions.minecraftPackNoIntegration')}</p>
      ) : (
        <Field label={t('actions.integration')}>
          <Select value={selected} onChange={(e) => setChoice(e.target.value)}>
            {minecraft.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}

function ProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile | null;
  onClose: () => void;
  onSaved: (p: Profile) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(profile?.name ?? '');
  const [game, setGame] = useState(profile?.game ?? '');
  const [save, busy] = useAction(async () => {
    const p = profile
      ? await api.profiles.update(profile.id, name, game)
      : await api.profiles.create(name, game);
    onSaved(p);
  });
  return (
    <Modal
      title={profile ? profile.name : t('actions.newProfile')}
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
        <Field label={t('actions.profileName')}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('actions.game')}>
          <Input value={game} onChange={(e) => setGame(e.target.value)} placeholder="Minecraft" />
        </Field>
      </div>
    </Modal>
  );
}

function ActionList({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const gifts = useStore((s) => s.gifts);
  const [actions, reload] = useLoad(() => api.actions.list(profile.id), [profile.id]);
  const [editing, setEditing] = useState<Action | 'new' | null>(null);
  const [toggle] = useAction(async (a: Action) => {
    await api.actions.save({ ...a, enabled: !a.enabled });
    reload();
  });
  const [test] = useAction((id: string) => api.actions.test(id), t('actions.testSent'));
  const [remove] = useAction(async (a: Action) => {
    if (!confirm(t('common.confirmDelete', { name: a.name }))) return;
    await api.actions.remove(a.id);
    reload();
  });

  return (
    <Card
      title={`${t('nav.actions')} — ${profile.name}`}
      actions={
        <Button variant="primary" onClick={() => setEditing('new')}>
          ＋ {t('actions.newAction')}
        </Button>
      }
    >
      {!actions?.length ? (
        <Empty>{t('actions.empty')}</Empty>
      ) : (
        <div className="divide-y divide-ink-800">
          {actions.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-2.5">
              <Toggle checked={a.enabled} onChange={() => void toggle(a)} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.name}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <Badge color="pink">{triggerSummary(t, a.trigger, gifts)}</Badge>
                  <span>{t('actions.effects', { count: a.effects.length })}</span>
                  {a.quantityMode === 'multiply' && <span>× {t('actions.quantityMultiply')}</span>}
                  {a.cooldownMs > 0 && <span>⏱ {a.cooldownMs / 1000}s</span>}
                </div>
              </div>
              <Button size="sm" onClick={() => void test(a.id)}>
                ▶ {t('common.test')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                {t('common.edit')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(a)}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <ActionEditor
          profileId={profile.id}
          action={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}
