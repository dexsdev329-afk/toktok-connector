import type { LiveEvent } from './events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Entries of the live journal shown in the app (events + effect executions). */
export type JournalEntry =
  | { kind: 'event'; ts: number; event: LiveEvent }
  | {
      kind: 'action';
      ts: number;
      actionId: string;
      actionName: string;
      status: 'queued' | 'started' | 'done' | 'skipped' | 'failed';
      detail?: string;
    }
  | { kind: 'system'; ts: number; level: LogLevel; message: string };
