import {
  contextFromEvent,
  hasUser,
  makeId,
  type Action,
  type Effect,
  type JournalEntry,
  type LiveEvent,
  type TemplateContext,
} from '@toktok/shared';
import { MatchState, matchAction, passesPlatformFilter, passesUserFilter } from './matcher';

export interface EffectRunner {
  run(effect: Effect, ctx: TemplateContext, signal: AbortSignal): Promise<void>;
}

export interface EngineOptions {
  runner: EffectRunner;
  journal?: (entry: JournalEntry) => void;
  /** Jobs running at the same time (different actions). */
  concurrency?: number;
  /** Maximum pending jobs; new jobs are dropped beyond. */
  maxQueue?: number;
  /** Maximum job starts per second (token bucket). */
  maxPerSecond?: number;
  now?: () => number;
  /** Hook called when a job starts (used for sounds/TTS attached to the action). */
  onJobStart?: (action: Action, ctx: TemplateContext) => void;
}

interface Job {
  id: string;
  seq: number;
  action: Action;
  ctx: TemplateContext;
}

export interface EngineStats {
  pending: number;
  running: number;
}

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return signal.aborted ? Promise.reject(new AbortError()) : Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Turns live events into action executions.
 *
 * Pipeline: match -> user filter -> cooldowns -> busy policy -> priority queue
 *           -> rate limit -> sequential effects (one running job per action).
 */
export class ActionEngine {
  private actions: Action[] = [];
  private readonly state = new MatchState();
  private readonly pending: Job[] = [];
  private readonly running = new Map<string, { job: Job; ctrl: AbortController }>();
  private readonly lastFired = new Map<string, number>();
  private readonly lastFiredByUser = new Map<string, number>();
  private seq = 0;
  private tokens: number;
  private lastRefill: number;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly concurrency: number;
  private readonly maxQueue: number;
  private readonly maxPerSecond: number;
  private readonly now: () => number;

  constructor(private readonly opts: EngineOptions) {
    this.concurrency = opts.concurrency ?? 3;
    this.maxQueue = opts.maxQueue ?? 500;
    this.maxPerSecond = opts.maxPerSecond ?? 20;
    this.now = opts.now ?? Date.now;
    this.tokens = this.maxPerSecond;
    this.lastRefill = this.now();
  }

  setActions(actions: Action[]): void {
    this.actions = [...actions].sort((a, b) => a.position - b.position);
  }

  /** New live session: like counters and cooldowns start over. */
  resetSession(): void {
    this.state.reset();
    this.lastFired.clear();
    this.lastFiredByUser.clear();
  }

  stats(): EngineStats {
    return { pending: this.pending.length, running: this.running.size };
  }

  handleEvent(event: LiveEvent): void {
    for (const action of this.actions) {
      if (!action.enabled) continue;
      if (!passesPlatformFilter(action, event)) continue;
      const match = matchAction(action, event, this.state);
      if (match.units < 1) continue;
      const user = hasUser(event) ? event.user : undefined;
      if (!passesUserFilter(action.userFilter, user)) {
        this.log(action, 'skipped', 'filtre utilisateur');
        continue;
      }
      if (action.busyPolicy === 'skip' && this.isBusy(action.id)) {
        this.log(action, 'skipped', 'action occupée');
        continue;
      }
      if (!this.checkCooldowns(action, user?.id)) continue;

      if (action.quantityMode === 'multiply') {
        const n = Math.min(match.units, action.maxMultiplier);
        for (let i = 0; i < n; i++) {
          this.enqueue(action, contextFromEvent(event, match.countPerExecution));
        }
      } else {
        this.enqueue(action, contextFromEvent(event));
      }
    }
    this.pump();
  }

  /** Manual trigger (test button, Stream Deck): bypasses matching and cooldowns. */
  triggerManually(action: Action, ctx: TemplateContext): void {
    this.enqueue(action, ctx);
    this.pump();
  }

  /** Drops pending jobs and aborts running ones. */
  clearQueue(): void {
    const dropped = this.pending.splice(0, this.pending.length);
    for (const job of dropped) this.log(job.action, 'skipped', 'file vidée');
    for (const { ctrl } of this.running.values()) ctrl.abort();
  }

  dispose(): void {
    this.clearQueue();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
  }

  private checkCooldowns(action: Action, userId: string | undefined): boolean {
    const now = this.now();
    if (action.cooldownMs > 0) {
      const last = this.lastFired.get(action.id);
      if (last !== undefined && now - last < action.cooldownMs) {
        this.log(action, 'skipped', 'cooldown');
        return false;
      }
    }
    const userKey = userId !== undefined ? `${action.id}|${userId}` : null;
    if (action.userCooldownMs > 0 && userKey) {
      const last = this.lastFiredByUser.get(userKey);
      if (last !== undefined && now - last < action.userCooldownMs) {
        this.log(action, 'skipped', 'cooldown viewer');
        return false;
      }
    }
    this.lastFired.set(action.id, now);
    if (userKey) this.lastFiredByUser.set(userKey, now);
    return true;
  }

  private isBusy(actionId: string): boolean {
    if (this.running.has(actionId)) return true;
    return this.pending.some((j) => j.action.id === actionId);
  }

  private enqueue(action: Action, ctx: TemplateContext): void {
    if (this.pending.length >= this.maxQueue) {
      this.log(action, 'skipped', 'file pleine');
      return;
    }
    const job: Job = { id: makeId('job'), seq: this.seq++, action, ctx };
    // Keep pending sorted: priority desc, then FIFO.
    let i = this.pending.length;
    while (i > 0) {
      const prev = this.pending[i - 1]!;
      if (prev.action.priority >= action.priority) break;
      i--;
    }
    this.pending.splice(i, 0, job);
    this.log(action, 'queued');
  }

  private refillTokens(): void {
    const now = this.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.maxPerSecond, this.tokens + (elapsed / 1000) * this.maxPerSecond);
    this.lastRefill = now;
  }

  private pump(): void {
    this.refillTokens();
    while (this.running.size < this.concurrency) {
      const idx = this.pending.findIndex((j) => !this.running.has(j.action.id));
      if (idx === -1) return;
      if (this.tokens < 1) {
        this.schedulePump(Math.ceil(((1 - this.tokens) / this.maxPerSecond) * 1000));
        return;
      }
      this.tokens -= 1;
      const [job] = this.pending.splice(idx, 1);
      void this.runJob(job!);
    }
  }

  private schedulePump(ms: number): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.pump();
    }, ms);
  }

  private async runJob(job: Job): Promise<void> {
    const ctrl = new AbortController();
    this.running.set(job.action.id, { job, ctrl });
    this.log(job.action, 'started');
    try {
      this.opts.onJobStart?.(job.action, job.ctx);
    } catch {
      // Side features (sound/TTS) must never block effects.
    }
    const errors: string[] = [];
    try {
      for (const effect of job.action.effects) {
        await abortableSleep(effect.delayMs, ctrl.signal);
        for (let r = 0; r < effect.repeat; r++) {
          if (r > 0) await abortableSleep(effect.repeatIntervalMs, ctrl.signal);
          try {
            await this.opts.runner.run(effect, job.ctx, ctrl.signal);
          } catch (err) {
            if (err instanceof AbortError || ctrl.signal.aborted) throw new AbortError();
            errors.push(`${effect.effectId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      if (errors.length) this.log(job.action, 'failed', errors.join(' | '));
      else this.log(job.action, 'done');
    } catch (err) {
      this.log(job.action, 'skipped', err instanceof AbortError ? 'annulé' : String(err));
    } finally {
      this.running.delete(job.action.id);
      this.pump();
    }
  }

  private log(action: Action, status: Extract<JournalEntry, { kind: 'action' }>['status'], detail?: string) {
    this.opts.journal?.({
      kind: 'action',
      ts: this.now(),
      actionId: action.id,
      actionName: action.name,
      status,
      ...(detail !== undefined ? { detail } : {}),
    });
  }
}
