import type { LiveEvent } from './events';

/** Variables available in effect templates: {username}, {giftName}, ... */
export interface TemplateContext {
  username: string;
  displayName: string;
  giftName: string;
  giftId: string;
  /** Gift units (or likes) attached to the event, after multiplier split. */
  count: number;
  /** Total diamonds for this execution. */
  diamonds: number;
  message: string;
  /** Total likes of the session (like events) / viewers (viewerCount). */
  total: number;
  platform: string;
}

export const TEMPLATE_VARIABLES: (keyof TemplateContext)[] = [
  'username',
  'displayName',
  'giftName',
  'giftId',
  'count',
  'diamonds',
  'message',
  'total',
  'platform',
];

export function contextFromEvent(event: LiveEvent, countOverride?: number): TemplateContext {
  const ctx: TemplateContext = {
    username: '',
    displayName: '',
    giftName: '',
    giftId: '',
    count: 1,
    diamonds: 0,
    message: '',
    total: 0,
    platform: event.platform,
  };
  if ('user' in event) {
    ctx.username = event.user.username;
    ctx.displayName = event.user.displayName;
  }
  switch (event.type) {
    case 'gift':
      ctx.giftName = event.gift.name;
      ctx.giftId = event.gift.id;
      ctx.count = countOverride ?? event.count;
      ctx.diamonds = event.gift.diamonds * ctx.count;
      break;
    case 'like':
      ctx.count = countOverride ?? event.count;
      ctx.total = event.total;
      break;
    case 'chat':
      ctx.message = event.text;
      break;
    case 'viewerCount':
      ctx.total = event.count;
      break;
    default:
      break;
  }
  return ctx;
}

/**
 * raw       -> no escaping (still strips control characters)
 * minecraft -> safe inside a quoted JSON text component of a Minecraft command
 * json      -> safe inside a JSON string literal
 * url       -> encodeURIComponent
 */
export type EscapeMode = 'raw' | 'minecraft' | 'json' | 'url';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function escapeValue(value: string, mode: EscapeMode): string {
  const clean = value.replace(CONTROL_CHARS, ' ');
  switch (mode) {
    case 'raw':
      return clean;
    case 'json':
      return JSON.stringify(clean).slice(1, -1);
    case 'minecraft':
      // Formatting codes (§) could be abused; quotes/backslashes would break the command.
      // Escape twice-safe: JSON escaping, then also neutralise single quotes used for SNBT strings.
      return JSON.stringify(clean.replace(/§/g, '')).slice(1, -1).replace(/'/g, "\\'");
    case 'url':
      return encodeURIComponent(clean);
  }
}

const VAR_PATTERN = /\{(\w+)\}/g;

/** Replace {variables}. Unknown variables are left untouched so typos stay visible. */
export function renderTemplate(template: string, ctx: TemplateContext, mode: EscapeMode = 'raw'): string {
  return template.replace(VAR_PATTERN, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(ctx, name)) return match;
    const value = ctx[name as keyof TemplateContext];
    return escapeValue(String(value), mode);
  });
}
