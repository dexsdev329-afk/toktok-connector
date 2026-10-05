import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomeGameDto } from '../../../shared/api';
import { Button, Card, Empty, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useLoad } from '../lib/hooks';
import { toast } from '../lib/toast';

const snippet = (origin: string) => `<script src="${origin}/toktok-game-client.js"></script>
<script>
  const game = TokTokGame.connect();
  game.on('event', (e) => {
    if (e.type === 'gift') dropCoins(e.count * e.gift.diamonds);
  });
  game.on('effect', (fx) => {
    if (fx.effect === 'bonus') startBonus(fx.params);
  });
</script>`;

export function HomeGamesPage() {
  const { t } = useTranslation();
  const [games, reload] = useLoad(() => api.homeGames.list());
  const [info] = useLoad(() => api.app.info());
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [addUrl, busyUrl] = useAction(async () => {
    await api.homeGames.addUrl(name, url);
    setName('');
    setUrl('');
    reload();
  });
  const [addFolder, busyFolder] = useAction(async () => {
    if (await api.homeGames.addFolder(name)) {
      setName('');
      reload();
    }
  });
  const [open] = useAction((id: string) => api.homeGames.open(id));
  const [remove] = useAction(async (g: HomeGameDto) => {
    if (!confirm(t('common.confirmDelete', { name: g.name }))) return;
    await api.homeGames.remove(g.id);
    reload();
  });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Card title={t('homeGames.add')}>
          <div className="grid gap-3">
            <Field label={t('homeGames.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Coin Pusher 3D" />
            </Field>
            <div className="flex items-end gap-2">
              <Field label={t('homeGames.url')} className="flex-1">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mon-jeu.up.railway.app"
                />
              </Field>
              <Button
                variant="primary"
                disabled={!name.trim() || !url.trim() || busyUrl}
                onClick={() => void addUrl()}
              >
                {t('common.add')}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{t('homeGames.or')}</span>
              <Button disabled={!name.trim() || busyFolder} onClick={() => void addFolder()}>
                📁 {t('homeGames.folder')}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t('nav.games')}>
          {!games?.length ? (
            <Empty>{t('homeGames.empty')}</Empty>
          ) : (
            <div className="divide-y divide-ink-800">
              {games.map((g) => (
                <div key={g.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{g.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {g.source} · {t('overlays.connected', { count: g.connected })}
                    </div>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => void open(g.id)}>
                    ▶ {t('homeGames.open')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(g.launchUrl)
                        .then(() => toast(t('common.copied'), 'success'))
                    }
                  >
                    {t('homeGames.copyObs')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(g)}>
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card title={t('homeGames.howTo')}>
        <p className="mb-2 text-sm text-slate-400">{t('homeGames.howToText')}</p>
        <pre className="overflow-x-auto rounded-lg bg-ink-950 p-3 text-xs text-slate-300">
          {snippet(info?.serverOrigin || 'http://127.0.0.1:21213')}
        </pre>
        <p className="mt-2 text-xs text-slate-500">{t('homeGames.howToEffects')}</p>
      </Card>
    </div>
  );
}
