import type { BridgeApi, DesktopApi, PushEvents } from '../../../shared/api';

declare global {
  interface Window {
    toktok: BridgeApi;
  }
}

/** Typed proxy: `api.connection.connect('me')` -> IPC invoke('connection', 'connect', ['me']). */
export const api = new Proxy({} as DesktopApi, {
  get(_t, ns: string) {
    return new Proxy(
      {},
      {
        get(_t2, method: string) {
          return (...args: unknown[]) =>
            (window.toktok.invoke as (...a: unknown[]) => Promise<unknown>)(ns, method, ...args);
        },
      },
    );
  },
});

export function onPush<K extends keyof PushEvents>(channel: K, listener: (payload: PushEvents[K]) => void) {
  return window.toktok.on(channel, listener);
}

/** Strips Electron's "Error invoking remote method 'api': Error:" prefix. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}
