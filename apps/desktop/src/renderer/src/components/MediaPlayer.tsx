import { useEffect } from 'react';
import { api, onPush } from '../lib/api';

/**
 * Plays audio requested by the main process (sounds, ElevenLabs) and speaks with
 * speechSynthesis, then reports the end so the main process can chain the next one.
 */
export function MediaPlayer() {
  useEffect(() => {
    const playing = new Map<string, () => void>();
    const finish = (id: string) => {
      if (!playing.has(id)) return;
      playing.delete(id);
      void api.media.ended(id).catch(() => undefined);
    };
    return onPush('media', (req) => {
      if (req.kind === 'stop') {
        playing.get(req.id)?.();
        finish(req.id);
        return;
      }
      if (req.kind === 'audio') {
        const audio = new Audio(req.src);
        audio.volume = Math.min(1, Math.max(0, req.volume));
        playing.set(req.id, () => audio.pause());
        audio.onended = () => finish(req.id);
        audio.onerror = () => finish(req.id);
        audio.play().catch(() => finish(req.id));
        return;
      }
      const u = new SpeechSynthesisUtterance(req.text);
      const voice = speechSynthesis.getVoices().find((v) => v.name === req.voice);
      if (voice) u.voice = voice;
      u.rate = Math.min(2, Math.max(0.5, req.rate));
      u.volume = Math.min(1, Math.max(0, req.volume));
      playing.set(req.id, () => speechSynthesis.cancel());
      u.onend = () => finish(req.id);
      u.onerror = () => finish(req.id);
      speechSynthesis.speak(u);
    });
  }, []);
  return null;
}
