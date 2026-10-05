import { ViewersOverlayOptionsSchema } from '@toktok/shared';

const formatter = new Intl.NumberFormat('fr-FR');

export function Viewers(props: { options: Record<string, unknown>; viewers: number; likes: number }) {
  const opts = ViewersOverlayOptionsSchema.parse(props.options);
  return (
    <div className="card viewers">
      <span className="viewers-dot" />
      <span className="viewers-count">{formatter.format(props.viewers)}</span>
      {opts.label && <span className="viewers-label">{opts.label}</span>}
      {opts.showLikes && <span className="viewers-likes">❤ {formatter.format(props.likes)}</span>}
    </div>
  );
}
