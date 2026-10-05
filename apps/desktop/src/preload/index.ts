import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const PUSH_CHANNELS = new Set(['connection', 'session', 'journal', 'integrations']);

/**
 * Minimal, generic bridge: a single invoke channel (validated by the main process)
 * and a fixed list of push channels. No Node API reaches the renderer.
 */
contextBridge.exposeInMainWorld('toktok', {
  invoke: (ns: string, method: string, ...args: unknown[]) => ipcRenderer.invoke('api', ns, method, args),
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!PUSH_CHANNELS.has(channel)) throw new Error(`Unknown channel ${channel}`);
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(`push:${channel}`, wrapped);
    return () => ipcRenderer.removeListener(`push:${channel}`, wrapped);
  },
});
