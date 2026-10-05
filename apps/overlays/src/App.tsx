import type { OverlayConfig, OverlayServerMessage, RecentFollower, TopDonor } from '@toktok/shared';
import { useCallback, useState, type CSSProperties } from 'react';
import { Alerts, type AlertItem } from './overlays/Alerts';
import { Chat, type TimedChatLine } from './overlays/Chat';
import { LikeGoal } from './overlays/LikeGoal';
import { RecentFollowers } from './overlays/RecentFollowers';
import { Timer, type TimerSnapshot } from './overlays/Timer';
import { TopDonors } from './overlays/TopDonors';
import { Viewers } from './overlays/Viewers';
import { Wheel, type WheelSpin } from './overlays/Wheel';
import { useOverlaySocket } from './useOverlaySocket';

export function App() {
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [donors, setDonors] = useState<TopDonor[]>([]);
  const [likes, setLikes] = useState({ total: 0, goal: 1 });
  const [chat, setChat] = useState<TimedChatLine[]>([]);
  const [viewers, setViewers] = useState({ viewers: 0, likes: 0 });
  const [spin, setSpin] = useState<WheelSpin | null>(null);
  const [timer, setTimer] = useState<TimerSnapshot>({ running: false, remainingMs: 0, receivedAt: 0 });
  const [followers, setFollowers] = useState<RecentFollower[]>([]);

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
      case 'chat': {
        const now = Date.now();
        const lines = msg.lines.map((l) => ({ ...l, receivedAt: now }));
        setChat((c) => (msg.replace ? lines : [...c, ...lines].slice(-30)));
        break;
      }
      case 'viewers':
        setViewers({ viewers: msg.viewers, likes: msg.likes });
        break;
      case 'wheelSpin':
        setSpin(msg.spin);
        break;
      case 'timer':
        setTimer({ running: msg.running, remainingMs: msg.remainingMs, receivedAt: performance.now() });
        break;
      case 'recentFollowers':
        setFollowers(msg.users);
        break;
    }
  }, []);
  useOverlaySocket(onMessage);
  // Stable callback: the alert timer must not restart when new alerts are queued.
  const onAlertDone = useCallback((id: string) => setAlerts((q) => q.filter((a) => a.id !== id)), []);

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
      {config.kind === 'alerts' && <Alerts options={config.options} queue={alerts} onDone={onAlertDone} />}
      {config.kind === 'top-donors' && <TopDonors options={config.options} donors={donors} />}
      {config.kind === 'like-goal' && (
        <LikeGoal options={config.options} total={likes.total} goal={likes.goal} />
      )}
      {config.kind === 'chat' && <Chat options={config.options} lines={chat} />}
      {config.kind === 'viewers' && <Viewers options={config.options} {...viewers} />}
      {config.kind === 'wheel' && <Wheel options={config.options} spin={spin} />}
      {config.kind === 'timer' && <Timer options={config.options} timer={timer} />}
      {config.kind === 'recent-followers' && <RecentFollowers options={config.options} users={followers} />}
    </div>
  );
}
