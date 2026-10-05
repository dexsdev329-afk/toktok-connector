import { RecentFollowersOverlayOptionsSchema, type RecentFollower } from '@toktok/shared';

export function RecentFollowers(props: { options: Record<string, unknown>; users: RecentFollower[] }) {
  const opts = RecentFollowersOverlayOptionsSchema.parse(props.options);
  const users = props.users.slice(0, opts.limit);
  return (
    <div className="card donors followers">
      {opts.title && <div className="donors-title">{opts.title}</div>}
      {users.length === 0 && <div className="donors-empty">—</div>}
      <ol>
        {users.map((u, i) => (
          <li key={u.id} className="follower-row enter" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="follower-icon">{u.kind === 'subscribe' ? '★' : '＋'}</span>
            {u.avatarUrl ? (
              <img className="donor-avatar" src={u.avatarUrl} alt="" />
            ) : (
              <span className="donor-avatar" />
            )}
            <span className="donor-name">{u.displayName}</span>
            <span className={`chat-platform platform-${u.platform}`}>
              {u.platform === 'kick' ? 'K' : 'TT'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
