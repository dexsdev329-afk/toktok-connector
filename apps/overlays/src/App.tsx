import type { OverlayConfig, OverlayServerMessage, TopDonor } from '@toktok/shared';
import { useCallback, useState, type CSSProperties } from 'react';
import { Alerts, type AlertItem } from './overlays/Alerts';
import { LikeGoal } from './overlays/LikeGoal';
import { TopDonors } from './overlays/TopDonors';
import { useOverlaySocket } from './useOverlaySocket';

export function App() {
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [donors, setDonors] = useState<TopDonor[]>([]);
  const [likes, setLikes] = useState({ total: 0, goal: 1 });

  const onMessage = useCallback((msg: OverlayServerMessage) => {
    switch (msg.type) {
      case 'config':
        setConfig(msg.overlay);
        break;
      case 'alert':
        setAlerts((q) => [...q, msg.alert].slice(-50));
        break;
      case 'topDonors':
        setDonors(msg.donors);
        break;
      case 'likes':
        setLikes({ total: msg.total, goal: msg.goal });
        break;
    }
  }, []);
  useOverlaySocket(onMessage);

  if (!config) return null;
  const s = config.style;
  const vars = {
    '--primary': s.primaryColor,
    '--text': s.textColor,
    '--font': s.fontFamily,
    '--size': `${s.fontSizePx}px`,
  } as CSSProperties;

  return (
    <div className={`overlay theme-${s.theme} anim-${s.animation}`} style={vars}>
      {config.kind === 'alerts' && (
        <Alerts
          options={config.options}
          queue={alerts}
          onDone={(id) => setAlerts((q) => q.filter((a) => a.id !== id))}
        />
      )}
      {config.kind === 'top-donors' && <TopDonors options={config.options} donors={donors} />}
      {config.kind === 'like-goal' && (
        <LikeGoal options={config.options} total={likes.total} goal={likes.goal} />
      )}
    </div>
  );
}
