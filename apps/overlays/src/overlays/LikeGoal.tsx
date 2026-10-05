import { LikeGoalOverlayOptionsSchema } from '@toktok/shared';

const formatter = new Intl.NumberFormat('fr-FR');

export function LikeGoal(props: { options: Record<string, unknown>; total: number; goal: number }) {
  const opts = LikeGoalOverlayOptionsSchema.parse(props.options);
  const goal = Math.max(1, props.goal);
  const ratio = Math.min(1, props.total / goal);
  const reached = props.total >= goal;
  return (
    <div className={`card goal ${reached ? 'goal-reached' : ''}`}>
      <div className="goal-header">
        <span>{opts.title}</span>
        <span className="goal-count">
          {formatter.format(props.total)} / {formatter.format(goal)}
        </span>
      </div>
      <div className="goal-track">
        <div className="goal-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
