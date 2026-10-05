import { AlertsOverlayOptionsSchema, type OverlayServerMessage } from '@toktok/shared';
import { useEffect } from 'react';

export type AlertItem = Extract<OverlayServerMessage, { type: 'alert' }>['alert'];

const LABELS: Record<AlertItem['kind'], string> = {
  gift: 'a envoyé',
  follow: 'suit le live !',
  share: 'a partagé le live !',
  subscribe: 's’est abonné !',
};

/** Shows alerts one after the other, each for `durationMs`. */
export function Alerts(props: {
  options: Record<string, unknown>;
  queue: AlertItem[];
  onDone: (id: string) => void;
}) {
  const opts = AlertsOverlayOptionsSchema.parse(props.options);
  const current = props.queue[0];
  const { onDone } = props;

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => onDone(current.id), opts.durationMs);
    return () => clearTimeout(t);
  }, [current?.id, opts.durationMs, onDone]);

  if (!current) return null;
  return (
    <div className="alerts">
      <div key={current.id} className="card alert-card enter" style={{ animationDuration: '450ms' }}>
        {current.gift?.imageUrl ? (
          <img className="alert-gift" src={current.gift.imageUrl} alt="" />
        ) : current.user.avatarUrl ? (
          <img className="alert-avatar" src={current.user.avatarUrl} alt="" />
        ) : (
          <div className="alert-icon">
            {current.kind === 'gift' ? '🎁' : current.kind === 'follow' ? '➕' : '★'}
          </div>
        )}
        <div className="alert-text">
          <div className="alert-name">{current.user.displayName}</div>
          <div className="alert-detail">
            {LABELS[current.kind]}
            {current.kind === 'gift' && current.gift && (
              <>
                {' '}
                <strong>
                  {current.count && current.count > 1 ? `${current.count}× ` : ''}
                  {current.gift.name}
                </strong>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
