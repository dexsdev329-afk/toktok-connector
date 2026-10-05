import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MinecraftServerState } from '../../../shared/api';
import { Badge, Button, Card, Select, Toggle, cx } from '../components/ui';
import { api, onPush } from '../lib/api';
import { useAction } from '../lib/hooks';
import { toast } from '../lib/toast';

const EULA_URL = 'https://aka.ms/MinecraftEULA';

/** "Minecraft en 1 clic": no file to edit, no command to know. */
export function MinecraftPage() {
  const { t } = useTranslation();
  const [edition, setEdition] = useState<'java' | 'bedrock'>('java');
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-400">{t('minecraft.intro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['java', 'bedrock'] as const).map((e) => (
          <button
            key={e}
            onClick={() => setEdition(e)}
            className={cx(
              'rounded-xl border p-4 text-left transition-colors',
              edition === e
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-ink-700 bg-ink-850 hover:border-ink-600',
            )}
          >
            <div className="text-lg font-bold">{t(`minecraft.${e}.title`)}</div>
            <div className="mt-1 text-sm text-slate-400">{t(`minecraft.${e}.who`)}</div>
          </button>
        ))}
      </div>
      {edition === 'java' ? <JavaServer /> : <Bedrock />}
    </div>
  );
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done?: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div
        className={cx(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black',
          done ? 'bg-emerald-500 text-ink-950' : 'bg-brand-500 text-white',
        )}
      >
        {done ? '✓' : n}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <div className="font-semibold">{title}</div>
        <div className="mt-1 text-sm text-slate-300">{children}</div>
      </div>
    </div>
  );
}

function CopyBox({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="rounded-lg bg-ink-950 px-3 py-2 font-mono text-base text-cyan-glow">{value}</code>
      <Button
        size="sm"
        variant="primary"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => toast(t('common.copied'), 'success'))
        }
      >
        {t('common.copy')}
      </Button>
    </div>
  );
}

function JavaServer() {
  const { t } = useTranslation();
  const [state, setState] = useState<MinecraftServerState | null>(null);
  const [versions, setVersions] = useState<{ latest: string; versions: string[] } | null>(null);
  const [version, setVersion] = useState('');
  const [eula, setEula] = useState(false);
  const [address, setAddress] = useState('localhost');
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    void api.minecraft.server().then(setState);
    void api.minecraft.address().then(setAddress);
    api.minecraft
      .versions()
      .then((v) => {
        setVersions(v);
        setVersion((cur) => cur || v.latest);
      })
      .catch(() => setVersions(null));
    return onPush('minecraft', setState);
  }, []);

  const [install, installing] = useAction(async () => {
    await api.minecraft.install(version, eula);
    await api.minecraft.start();
    setAddress(await api.minecraft.address());
  });
  const [start] = useAction(() => api.minecraft.start());
  const [stop] = useAction(() => api.minecraft.stop());
  const [test] = useAction(() => api.minecraft.test('java'), t('minecraft.testSent'));
  const [openFolder] = useAction(() => api.minecraft.openFolder());
  if (!state) return null;

  const installed = state.status !== 'not-installed' && !(state.status === 'error' && !state.version);
  const running = state.status === 'running';
  const busy = ['installing', 'starting', 'stopping'].includes(state.status) || installing;

  return (
    <Card
      title={t('minecraft.java.cardTitle')}
      actions={
        <Badge color={running ? 'green' : state.status === 'error' ? 'red' : busy ? 'yellow' : 'gray'}>
          {t(`minecraft.status.${state.status}`)}
          {state.version ? ` · ${state.version}` : ''}
        </Badge>
      }
    >
      <div className="flex flex-col gap-4">
        <Step n={1} done={installed && state.status !== 'installing'} title={t('minecraft.java.step1')}>
          {!installed || state.status === 'installing' ? (
            <div className="flex flex-col gap-3">
              <p>{t('minecraft.java.step1Help')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-slate-400">{t('minecraft.java.version')}</span>
                <Select
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="w-40"
                  disabled={busy}
                >
                  {(versions?.versions ?? (version ? [version] : [])).map((v) => (
                    <option key={v} value={v}>
                      {v}
                      {v === versions?.latest ? ` (${t('minecraft.java.latest')})` : ''}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-slate-500">{t('minecraft.java.versionHelp')}</span>
              </div>
              <Toggle
                checked={eula}
                onChange={setEula}
                label={
                  <>
                    {t('minecraft.java.eula')}{' '}
                    <a href={EULA_URL} target="_blank" rel="noreferrer" className="text-cyan-glow underline">
                      {t('minecraft.java.eulaLink')}
                    </a>
                  </>
                }
              />
              <div>
                <Button variant="primary" disabled={!eula || !version || busy} onClick={() => void install()}>
                  ⛏️ {t('minecraft.java.install')}
                </Button>
              </div>
            </div>
          ) : (
            <p>{t('minecraft.java.installed', { version: state.version })}</p>
          )}
          {state.step && (
            <div className="mt-3">
              <div className="text-xs text-slate-400">{state.step}</div>
              {state.percent !== undefined && (
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full bg-brand-500 transition-all"
                    style={{ width: `${state.percent}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </Step>

        <Step n={2} done={running} title={t('minecraft.java.step2')}>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="secondary" onClick={() => void stop()} disabled={busy}>
                ⏹ {t('minecraft.java.stop')}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void start()} disabled={!installed || busy}>
                ▶ {t('minecraft.java.start')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void openFolder()} disabled={!installed}>
              📁 {t('minecraft.java.folder')}
            </Button>
          </div>
          {state.status === 'starting' && (
            <p className="mt-2 text-slate-400">{t('minecraft.java.firstStart')}</p>
          )}
        </Step>

        <Step n={3} done={running && state.players.length > 0} title={t('minecraft.java.step3')}>
          <p>{t('minecraft.java.step3Help')}</p>
          <CopyBox value={address} />
          {running && (
            <p className="mt-2 text-slate-400">
              {state.players.length
                ? t('minecraft.java.players', { names: state.players.join(', ') })
                : t('minecraft.java.noPlayers')}
            </p>
          )}
        </Step>

        <Step n={4} done={false} title={t('minecraft.java.step4')}>
          <p>{t('minecraft.java.step4Help')}</p>
          <div className="mt-2">
            <Button size="sm" onClick={() => void test()} disabled={!running}>
              🧟 {t('minecraft.testZombie')}
            </Button>
          </div>
        </Step>

        {state.error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{state.error}</p>}
        {state.logs.length > 0 && (
          <div>
            <button
              className="text-xs text-slate-500 hover:text-slate-300"
              onClick={() => setShowLogs((v) => !v)}
            >
              {showLogs ? '▾' : '▸'} {t('minecraft.java.console')}
            </button>
            {showLogs && (
              <pre className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-ink-950 p-3 text-[11px] text-slate-400">
                {state.logs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function Bedrock() {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<{ command: string } | null>(null);
  const [prepare, preparing] = useAction(async () => setSetup(await api.minecraft.setupBedrock()));
  const [test] = useAction(() => api.minecraft.test('bedrock'), t('minecraft.testSent'));
  return (
    <Card title={t('minecraft.bedrock.cardTitle')}>
      <div className="flex flex-col gap-4">
        <Step n={1} done={!!setup} title={t('minecraft.bedrock.step1')}>
          <p>{t('minecraft.bedrock.step1Help')}</p>
          {!setup && (
            <div className="mt-2">
              <Button variant="primary" onClick={() => void prepare()} disabled={preparing}>
                ⛏️ {t('minecraft.bedrock.prepare')}
              </Button>
            </div>
          )}
        </Step>
        <Step n={2} title={t('minecraft.bedrock.step2')}>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('minecraft.bedrock.cheats')}</li>
            <li>{t('minecraft.bedrock.websockets')}</li>
          </ul>
        </Step>
        <Step n={3} title={t('minecraft.bedrock.step3')}>
          <p>{t('minecraft.bedrock.step3Help')}</p>
          {setup ? (
            <CopyBox value={setup.command} />
          ) : (
            <p className="text-slate-500">{t('minecraft.bedrock.afterStep1')}</p>
          )}
        </Step>
        <Step n={4} title={t('minecraft.java.step4')}>
          <p>{t('minecraft.java.step4Help')}</p>
          <div className="mt-2">
            <Button size="sm" onClick={() => void test()} disabled={!setup}>
              🧟 {t('minecraft.testZombie')}
            </Button>
          </div>
        </Step>
      </div>
    </Card>
  );
}
