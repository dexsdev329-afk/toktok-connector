import { useCallback, useEffect, useState } from 'react';
import { errorText } from './api';
import { toast } from './toast';

/** Loads data from the main process and exposes a reload function. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    loader()
      .then((d) => alive && setData(d))
      .catch((err: unknown) => toast(errorText(err), 'error'));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return [data, reload];
}

/** Wraps an async action with error toasts and a busy flag. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>, success?: string) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (...args: A) => {
      setBusy(true);
      try {
        await fn(...args);
        if (success) toast(success, 'success');
        return true;
      } catch (err) {
        toast(errorText(err), 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fn, success],
  );
  return [run, busy] as const;
}
