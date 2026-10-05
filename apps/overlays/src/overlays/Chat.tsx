import { ChatOverlayOptionsSchema, type ChatLine } from '@toktok/shared';
import { useEffect, useState } from 'react';

export interface TimedChatLine extends ChatLine {
  receivedAt: number;
}

const PLATFORM_LABEL: Record<string, string> = { tiktok: 'TikTok', kick: 'Kick', simulator: 'Test' };

export function Chat(props: { options: Record<string, unknown>; lines: TimedChatLine[] }) {
  const opts = ChatOverlayOptionsSchema.parse(props.options);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!opts.fadeAfterSec) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [opts.fadeAfterSec]);
  const visible = props.lines
    .filter((l) => !opts.fadeAfterSec || now - l.receivedAt < opts.fadeAfterSec * 1000)
    .slice(-opts.maxMessages);
  return (
    <div className="chat">
      {visible.map((l) => (
        <div key={l.id} className="card chat-line enter">
          {opts.showAvatars &&
            (l.user.avatarUrl ? (
              <img className="chat-avatar" src={l.user.avatarUrl} alt="" />
            ) : (
              <span className="chat-avatar" />
            ))}
          <div className="chat-body">
            <div className="chat-meta">
              {opts.showPlatform && (
                <span className={`chat-platform platform-${l.platform}`}>
                  {PLATFORM_LABEL[l.platform] ?? l.platform}
                </span>
              )}
              {l.user.isModerator && <span className="chat-badge">MOD</span>}
              {l.user.isSubscriber && <span className="chat-badge">SUB</span>}
              <span className="chat-name">{l.user.displayName}</span>
            </div>
            <div className="chat-text">{l.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
