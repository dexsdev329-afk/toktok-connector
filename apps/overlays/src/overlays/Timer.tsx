import { TimerOverlayOptionsSchema } from '@toktok/shared';
import { useEffect, useState } from 'react';

export interface TimerSnapshot {
  running: boolean;
  remainingMs: number;
  /** performance.now() when the snapshot was received. */
  receivedAt: number;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function Timer(props: { options: Record<string, unknown>; timer: TimerSnapshot }) {
  const opts = TimerOverlayOptionsSchema.parse(props.options);
  const [, tick] = useState(0);
  const { running, remainingMs, receivedAt } = props.timer;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [running]);
  const left = running ? remainingMs - (performance.now() - receivedAt) : remainingMs;
  const done = left <= 0;
  return (
    <div className={`card timer ${running ? 'timer-running' : 'timer-paused'} ${done ? 'timer-done' : ''}`}>
      {opts.title && <div className="timer-title">{opts.title}</div>}
      <div className="timer-value">{done ? opts.endText : formatDuration(left)}</div>
    </div>
  );
}
