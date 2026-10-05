import type { JournalEntry, LiveEvent } from '@toktok/shared';

type Listener<T> = (payload: T) => void;

export interface BusEvents {
  live: LiveEvent;
  journal: JournalEntry;
}

/**
 * Minimal typed pub/sub. Listener errors are isolated so one faulty subscriber
 * (an overlay, a plugin...) can never break event delivery to the others.
 */
export class EventBus {
  private readonly listeners: { [K in keyof BusEvents]: Set<Listener<BusEvents[K]>> } = {
    live: new Set(),
    journal: new Set(),
  };

  constructor(private readonly onListenerError: (err: unknown) => void = () => {}) {}

  on<K extends keyof BusEvents>(topic: K, listener: Listener<BusEvents[K]>): () => void {
    this.listeners[topic].add(listener);
    return () => this.listeners[topic].delete(listener);
  }

  emit<K extends keyof BusEvents>(topic: K, payload: BusEvents[K]): void {
    for (const l of [...this.listeners[topic]]) {
      try {
        l(payload);
      } catch (err) {
        this.onListenerError(err);
      }
    }
  }
}
