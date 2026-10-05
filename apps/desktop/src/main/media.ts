import { spawn } from 'node:child_process';
import { makeId } from '@toktok/shared';
import type { TtsEngine, TtsSettings } from '@toktok/core';
import type { MediaRequest } from '../shared/api';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type MediaPlayRequest = DistributiveOmit<Exclude<MediaRequest, { kind: 'stop' }>, 'id'>;

/**
 * Audio is played by the renderer (Chromium audio stack, default output device).
 * The main process sends a request and waits for the renderer to report the end.
 */
export class MediaBridge {
  private readonly pending = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly push: (req: MediaRequest) => void) {}

  play(req: MediaPlayRequest, signal?: AbortSignal, maxMs = 120_000): Promise<void> {
    const id = makeId('media');
    return new Promise<void>((resolve) => {
      const done = () => {
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        resolve();
      };
      this.pending.set(id, { resolve: done, timer: setTimeout(done, maxMs) });
      signal?.addEventListener(
        'abort',
        () => {
          this.push({ id, kind: 'stop' });
          done();
        },
        { once: true },
      );
      this.push({ ...req, id } as MediaRequest);
    });
  }

  /** Called by the renderer (IPC) when a media finished or failed. */
  ended(id: string): void {
    this.pending.get(id)?.resolve();
  }
}

/** Windows voices through System.Speech (no extra dependency). Text and voice go through stdin/env, never the command line. */
export function sapiEngine(): TtsEngine {
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'if ($env:TOKTOK_VOICE) { try { $s.SelectVoice($env:TOKTOK_VOICE) } catch {} }',
    '$s.Rate = [int]$env:TOKTOK_RATE',
    '$s.Volume = [int]$env:TOKTOK_VOLUME',
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    '$t = [Console]::In.ReadToEnd()',
    '$s.Speak($t)',
  ].join('; ');
  return {
    speak(text: string, s: TtsSettings, signal: AbortSignal): Promise<void> {
      if (process.platform !== 'win32')
        return Promise.reject(new Error('Voix Windows disponibles uniquement sous Windows'));
      return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
          env: {
            ...process.env,
            TOKTOK_VOICE: s.voice,
            TOKTOK_RATE: String(s.rate),
            TOKTOK_VOLUME: String(s.volume),
          },
        });
        const onAbort = () => child.kill();
        signal.addEventListener('abort', onAbort, { once: true });
        child.on('error', reject);
        child.on('exit', () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
        child.stdin.end(text, 'utf8');
      });
    },
  };
}

/** Lists installed Windows voices. */
export function listSapiVoices(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }',
      ],
      { windowsHide: true },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.on('error', () => resolve([]));
    child.on('exit', () =>
      resolve(
        out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    );
  });
}

/** Chromium speechSynthesis in the renderer (uses the OS voices). */
export function browserEngine(media: MediaBridge): TtsEngine {
  return {
    speak: (text, s, signal) =>
      media.play(
        { kind: 'speech', text, voice: s.voice, rate: 1 + s.rate / 10, volume: s.volume / 100 },
        signal,
      ),
  };
}

/** ElevenLabs text-to-speech (POST /v1/text-to-speech/{voice_id}, xi-api-key header). */
export function elevenLabsEngine(media: MediaBridge, getKey: () => string | null): TtsEngine {
  return {
    async speak(text, s, signal) {
      const key = getKey();
      if (!key || !s.elevenlabsVoiceId) throw new Error('Clé API ou voix ElevenLabs manquante');
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(s.elevenlabsVoiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());
      await media.play(
        { kind: 'audio', src: `data:audio/mpeg;base64,${audio.toString('base64')}`, volume: s.volume / 100 },
        signal,
      );
    },
  };
}
