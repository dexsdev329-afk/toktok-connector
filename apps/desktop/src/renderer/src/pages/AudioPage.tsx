import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SoundDto, TtsState } from '../../../shared/api';
import { Badge, Button, Card, Empty, Field, Input, Select, Textarea, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { useEntitlements } from '../lib/store';

export function AudioPage() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <TtsCard />
      <SoundsCard />
    </div>
  );
}

function TtsCard() {
  const { t } = useTranslation();
  const ent = useEntitlements();
  const [state, setState] = useState<TtsState | null>(null);
  const [voices] = useLoad(() => api.tts.voices());
  const [browserVoices, setBrowserVoices] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [testText, setTestText] = useState('Bonjour, merci pour le cadeau !');
  useEffect(() => {
    void api.tts.get().then(setState);
    const load = () => setBrowserVoices(speechSynthesis.getVoices().map((v) => v.name));
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  const [save] = useAction(async (patch: Partial<TtsState>, k?: string | null) => {
    const { hasElevenlabsKey: _h, ...rest } = patch;
    setState(await api.tts.update(rest, k));
  });
  const [test] = useAction(() => api.tts.test(testText));
  const [skip] = useAction(() => api.tts.skip());
  if (!state) return null;
  const set = (patch: Partial<TtsState>) => void save(patch);
  const voiceList = state.engine === 'sapi' ? (voices ?? []) : browserVoices;

  return (
    <Card
      title={t('audio.tts')}
      actions={
        <Toggle
          checked={state.enabled}
          onChange={(enabled) => set({ enabled })}
          label={t('common.enabled')}
        />
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('audio.engine')}>
            <Select
              value={state.engine}
              onChange={(e) => set({ engine: e.target.value as TtsState['engine'] })}
            >
              <option value="sapi">{t('audio.engines.sapi')}</option>
              <option value="browser">{t('audio.engines.browser')}</option>
              <option value="elevenlabs" disabled={!ent.premiumTts}>
                ElevenLabs{ent.premiumTts ? '' : ' (Pro)'}
              </option>
            </Select>
          </Field>
          {state.engine !== 'elevenlabs' ? (
            <Field label={t('audio.voice')}>
              <Select value={state.voice} onChange={(e) => set({ voice: e.target.value })}>
                <option value="">{t('audio.defaultVoice')}</option>
                {voiceList.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label={t('audio.elevenVoice')}>
              <Input
                defaultValue={state.elevenlabsVoiceId}
                onBlur={(e) => set({ elevenlabsVoiceId: e.target.value.trim() })}
              />
            </Field>
          )}
        </div>
        {state.engine === 'elevenlabs' && (
          <Field
            label={t('audio.elevenKey')}
            hint={state.hasElevenlabsKey ? `✓ ${t('settings.keySet')}` : undefined}
          >
            <div className="flex gap-2">
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={state.hasElevenlabsKey ? '••••••••' : ''}
              />
              <Button
                variant="primary"
                disabled={!key.trim()}
                onClick={() => void save({}, key).then(() => setKey(''))}
              >
                {t('common.save')}
              </Button>
            </div>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('audio.rate')} (${state.rate})`}>
            <input
              type="range"
              min={-10}
              max={10}
              value={state.rate}
              onChange={(e) => set({ rate: Number(e.target.value) })}
            />
          </Field>
          <Field label={`${t('audio.volume')} (${state.volume})`}>
            <input
              type="range"
              min={0}
              max={100}
              value={state.volume}
              onChange={(e) => set({ volume: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('audio.readChat')}>
            <Select
              value={state.readChat}
              onChange={(e) => set({ readChat: e.target.value as TtsState['readChat'] })}
            >
              {(['off', 'all', 'subscribers', 'moderators'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`audio.readChatValues.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('audio.giftMinDiamonds')}>
            <Input
              type="number"
              min={0}
              defaultValue={state.giftMinDiamonds}
              onBlur={(e) => set({ giftMinDiamonds: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>
        <Toggle
          checked={state.skipCommands}
          onChange={(skipCommands) => set({ skipCommands })}
          label={t('audio.skipCommands')}
        />
        <Field label={t('audio.chatTemplate')}>
          <Input defaultValue={state.chatTemplate} onBlur={(e) => set({ chatTemplate: e.target.value })} />
        </Field>
        <Field label={t('audio.giftTemplate')}>
          <Input defaultValue={state.giftTemplate} onBlur={(e) => set({ giftTemplate: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('audio.filter')}>
            <Select
              value={state.filterMode}
              onChange={(e) => set({ filterMode: e.target.value as TtsState['filterMode'] })}
            >
              {(['censor', 'skip', 'off'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`audio.filterValues.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('audio.maxQueue')}>
            <Input
              type="number"
              min={1}
              max={50}
              defaultValue={state.maxQueue}
              onBlur={(e) => set({ maxQueue: Math.max(1, Number(e.target.value) || 5) })}
            />
          </Field>
        </div>
        <Field label={t('audio.customWords')}>
          <Textarea
            rows={2}
            defaultValue={state.customWords.join(', ')}
            onBlur={(e) =>
              set({
                customWords: e.target.value
                  .split(',')
                  .map((w) => w.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <div className="flex gap-2">
          <Input value={testText} onChange={(e) => setTestText(e.target.value)} />
          <Button onClick={() => void test()}>▶ {t('common.test')}</Button>
          <Button variant="ghost" onClick={() => void skip()}>
            ⏭ {t('audio.skip')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SoundsCard() {
  const { t } = useTranslation();
  const [sounds, reload] = useLoad(() => api.sounds.list());
  const [master, setMaster] = useState<number | null>(null);
  useEffect(() => void api.sounds.getVolume().then(setMaster), []);
  const [importFiles] = useAction(async () => {
    await api.sounds.importFiles();
    reload();
  });
  const [play] = useAction((id: string) => api.sounds.play(id));
  const [update] = useAction(async (s: SoundDto) => api.sounds.update(s.id, s.name, s.volume));
  const [remove] = useAction(async (s: SoundDto) => {
    if (!confirm(t('common.confirmDelete', { name: s.name }))) return;
    await api.sounds.remove(s.id);
    reload();
  });

  return (
    <Card
      title={t('audio.sounds')}
      actions={<Button onClick={() => void importFiles()}>＋ {t('audio.import')}</Button>}
    >
      {master !== null && (
        <Field label={`${t('audio.masterVolume')} (${Math.round(master * 100)} %)`} className="mb-3">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(master * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setMaster(v);
              void api.sounds.setVolume(v);
            }}
          />
        </Field>
      )}
      {!sounds?.length ? (
        <Empty>{t('audio.noSounds')}</Empty>
      ) : (
        <div className="divide-y divide-ink-800">
          {sounds.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2">
              <Button size="sm" onClick={() => void play(s.id)}>
                ▶
              </Button>
              <Input
                className="flex-1"
                defaultValue={s.name}
                onBlur={(e) => void update({ ...s, name: e.target.value || s.name })}
              />
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={Math.round(s.volume * 100)}
                onMouseUp={(e) =>
                  void update({ ...s, volume: Number((e.target as HTMLInputElement).value) / 100 })
                }
                title={t('audio.volume')}
              />
              <Badge>{Math.round(s.volume * 100)} %</Badge>
              <Button size="sm" variant="ghost" onClick={() => void remove(s)}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
