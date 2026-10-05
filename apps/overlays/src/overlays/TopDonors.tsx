import { TopDonorsOverlayOptionsSchema, type TopDonor } from '@toktok/shared';

const formatter = new Intl.NumberFormat('fr-FR');

export function TopDonors(props: { options: Record<string, unknown>; donors: TopDonor[] }) {
  const opts = TopDonorsOverlayOptionsSchema.parse(props.options);
  const donors = props.donors.slice(0, opts.limit);
  return (
    <div className="card donors">
      {opts.title && <div className="donors-title">{opts.title}</div>}
      {donors.length === 0 && <div className="donors-empty">—</div>}
      <ol>
        {donors.map((d, i) => (
          <li key={d.userId} className="donor-row enter" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="donor-rank">{i + 1}</span>
            {d.avatarUrl ? (
              <img className="donor-avatar" src={d.avatarUrl} alt="" />
            ) : (
              <span className="donor-avatar" />
            )}
            <span className="donor-name">{d.displayName}</span>
            <span className="donor-value">{formatter.format(d.diamonds)} 💎</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
