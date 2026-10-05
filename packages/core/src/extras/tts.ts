import { renderTemplate, contextFromEvent, type LiveEvent } from '@toktok/shared';
import { z } from 'zod';
import { ProfanityFilter } from './profanity';

export const TtsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** sapi = Windows voices (PowerShell / System.Speech), browser = Chromium speechSynthesis, elevenlabs = API. */
  engine: z.enum(['sapi', 'browser', 'elevenlabs']).default('sapi'),
  voice: z.string().max(200).default(''),
  /** -10 (slow) .. 10 (fast), SAPI scale. */
  rate: z.number().int().min(-10).max(10).default(0),
  volume: z.number().int().min(0).max(100).default(100),
  readChat: z.enum(['off', 'all', 'subscribers', 'moderators']).default('off'),
  skipCommands: z.boolean().default(true),
  /** Read gifts worth at least this many diamonds (0 = never). */
  giftMinDiamonds: z.number().int().min(0).default(0),
  giftTemplate: z.string().max(200).default('{displayName} a envoyé {count} {giftName}, merci !'),
  chatTemplate: z.string().max(200).default('{displayName} dit : {message}'),
  filterMode: z.enum(['off', 'censor', 'skip']).default('censor'),
  customWords: z.array(z.string().max(60)).max(500).default([]),
  maxLength: z.number().int().min(20).max(500).default(200),
  /** Messages waiting beyond this are dropped (the live goes faster than speech). */
  maxQueue: z.number().int().min(1).max(50).default(5),
  elevenlabsVoiceId: z.string().max(100).default(''),
});
export type TtsSettings = z.infer<typeof TtsSettingsSchema>;

export interface TtsEngine {
  speak(text: string, settings: TtsSettings, signal: AbortSignal): Promise<void>;
}

/**
 * Text-to-speech queue: reads chat / gifts / action texts one at a time,
 * after the profanity filter, with a bounded queue.
 */
export class TtsService {
  private readonly queue: string[] = [];
  private speaking = false;
  private ctrl: AbortController | null = null;
  private readonly filter = new ProfanityFilter();
  private lastWords = '';

  constructor(
    private readonly getSettings: () => TtsSettings,
    private readonly engines: Partial<Record<TtsSettings['engine'], TtsEngine>>,
    private readonly log: (level: 'info' | 'warn', msg: string) => void = () => {},
  ) {}

  /** Live events: chat messages and big gifts, according to the settings. */
  handleEvent(event: LiveEvent): void {
    const s = this.getSettings();
    if (!s.enabled) return;
    if (event.type === 'chat' && s.readChat !== 'off') {
      if (s.skipCommands && event.text.trim().startsWith('!')) return;
      if (s.readChat === 'subscribers' && !event.user.isSubscriber && !event.user.isModerator) return;
      if (s.readChat === 'moderators' && !event.user.isModerator) return;
      this.say(renderTemplate(s.chatTemplate, contextFromEvent(event)));
    } else if (event.type === 'gift' && event.streakFinal && s.giftMinDiamonds > 0) {
      if (event.gift.diamonds * event.count < s.giftMinDiamonds) return;
      this.say(renderTemplate(s.giftTemplate, contextFromEvent(event)));
    }
  }

  /** Queues a text (filtered, truncated). Returns false when dropped. */
  say(raw: string): boolean {
    const s = this.getSettings();
    if (!s.enabled) return false;
    const custom = s.customWords.join('\n');
    if (custom !== this.lastWords) {
      this.filter.setCustomWords(s.customWords);
      this.lastWords = custom;
    }
    const filtered = this.filter.apply(raw.replace(/\s+/g, ' ').trim(), s.filterMode);
    if (!filtered) return false;
    if (this.queue.length >= s.maxQueue) return false;
    this.queue.push(filtered.slice(0, s.maxLength));
    void this.pump();
    return true;
  }

  /** Stops the current sentence and clears the queue. */
  skipAll(): void {
    this.queue.length = 0;
    this.ctrl?.abort();
  }

  get pending(): number {
    return this.queue.length;
  }

  private async pump(): Promise<void> {
    if (this.speaking) return;
    this.speaking = true;
    try {
      for (let text = this.queue.shift(); text !== undefined; text = this.queue.shift()) {
        const s = this.getSettings();
        const engine = this.engines[s.engine];
        if (!engine) {
          this.log('warn', `Moteur de synthèse vocale « ${s.engine} » indisponible`);
          this.queue.length = 0;
          break;
        }
        this.ctrl = new AbortController();
        try {
          await engine.speak(text, s, this.ctrl.signal);
        } catch (err) {
          if (!this.ctrl.signal.aborted)
            this.log('warn', `Synthèse vocale : ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      this.ctrl = null;
      this.speaking = false;
    }
  }
}
