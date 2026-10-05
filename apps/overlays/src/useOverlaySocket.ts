import type { OverlayServerMessage } from '@toktok/shared';
import { useEffect, useRef } from 'react';

/**
 * Connects to the app's local WebSocket with the id/token from the page URL and
 * reconnects forever (the app may be restarted while OBS keeps the page open).
 */
export function useOverlaySocket(onMessage: (msg: OverlayServerMessage) => void): void {
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    const id = location.pathname.split('/').filter(Boolean)[1] ?? '';
    const token = new URLSearchParams(location.search).get('t') ?? '';
    let ws: WebSocket | null = null;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const open = () => {
      const url = `ws://${location.host}/ws/overlay?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry = 1000;
      };
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(String(e.data)) as OverlayServerMessage);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 15_000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);
}
