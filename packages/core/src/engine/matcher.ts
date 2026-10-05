import type { Action, LiveEvent, LiveUser, UserFilter } from '@toktok/shared';

/**
 * Per-session state needed by stateful triggers (likes thresholds).
 * Reset on every new live session.
 */
export class MatchState {
  /** Cumulated likes per action id, for "every N likes" triggers. */
  private readonly likeCounters = new Map<string, number>();

  /** Returns how many thresholds were crossed by adding `count` likes. */
  addLikes(actionId: string, every: number, count: number): number {
    const before = this.likeCounters.get(actionId) ?? 0;
    const after = before + count;
    this.likeCounters.set(actionId, after);
    return Math.floor(after / every) - Math.floor(before / every);
  }

  reset(): void {
    this.likeCounters.clear();
  }
}

export interface MatchResult {
  /** Number of executions requested by this event (before cap). 0 = no match. */
  units: number;
  /** Units count to expose as {count} for each execution. */
  countPerExecution: number;
}

const NO_MATCH: MatchResult = { units: 0, countPerExecution: 0 };

export function parseCommand(text: string): { name: string; args: string } | null {
  const m = /^\s*!([\p{L}\p{N}_-]+)(?:\s+(.*))?$/su.exec(text);
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? '').trim() };
}

/**
 * Decides whether `action` matches `event` and how many times it should run.
 * Pure except for the like counters kept in `state`.
 */
export function matchAction(action: Action, event: LiveEvent, state: MatchState): MatchResult {
  const t = action.trigger;
  switch (t.kind) {
    case 'gift': {
      if (event.type !== 'gift' || event.gift.id !== t.giftId) return NO_MATCH;
      const units = Math.floor(event.count / t.minCount);
      if (units < 1) return NO_MATCH;
      return { units, countPerExecution: t.minCount };
    }
    case 'diamonds': {
      if (event.type !== 'gift') return NO_MATCH;
      const total = event.gift.diamonds * event.count;
      if (t.max !== undefined && total > t.max) return NO_MATCH;
      const units = Math.floor(total / t.min);
      if (units < 1) return NO_MATCH;
      // For a single gift type, express {count} in gift units when possible.
      const perExec = event.gift.diamonds > 0 ? Math.max(1, Math.ceil(t.min / event.gift.diamonds)) : 1;
      return { units, countPerExecution: perExec };
    }
    case 'likes': {
      if (event.type !== 'like' || event.count <= 0) return NO_MATCH;
      const crossed = state.addLikes(action.id, t.every, event.count);
      return crossed > 0 ? { units: crossed, countPerExecution: t.every } : NO_MATCH;
    }
    case 'follow':
    case 'share':
    case 'subscribe':
      return event.type === t.kind ? { units: 1, countPerExecution: 1 } : NO_MATCH;
    case 'command': {
      if (event.type !== 'chat') return NO_MATCH;
      const cmd = parseCommand(event.text);
      return cmd && cmd.name === t.name.toLowerCase() ? { units: 1, countPerExecution: 1 } : NO_MATCH;
    }
    case 'keyword': {
      if (event.type !== 'chat') return NO_MATCH;
      return event.text.toLowerCase().includes(t.text.toLowerCase())
        ? { units: 1, countPerExecution: 1 }
        : NO_MATCH;
    }
  }
}

/**
 * Role flags are OR-ed (e.g. "moderators" + "subscribers" lets both in).
 * The deny list always wins; a non-empty allow list also lets listed users in.
 */
export function passesUserFilter(filter: UserFilter, user: LiveUser | undefined): boolean {
  const anyRole = filter.moderatorsOnly || filter.subscribersOnly || filter.followersOnly;
  const restricted = anyRole || filter.allowList.length > 0;
  if (!user) return !restricted;
  const name = user.username.toLowerCase();
  if (filter.denyList.some((n) => n.toLowerCase() === name)) return false;
  if (!restricted) return true;
  if (filter.allowList.some((n) => n.toLowerCase() === name)) return true;
  if (filter.moderatorsOnly && user.isModerator) return true;
  if (filter.subscribersOnly && user.isSubscriber) return true;
  if (filter.followersOnly && user.isFollower) return true;
  return false;
}
