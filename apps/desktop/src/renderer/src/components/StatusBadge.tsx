import { useTranslation } from 'react-i18next';
import type { ConnectionStatus } from '../../../shared/api';
import { Badge } from './ui';

const COLORS: Record<ConnectionStatus, 'green' | 'yellow' | 'red' | 'gray'> = {
  idle: 'gray',
  connecting: 'yellow',
  connected: 'green',
  reconnecting: 'yellow',
  'waiting-live': 'yellow',
  error: 'red',
};

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  const { t } = useTranslation();
  return (
    <Badge color={COLORS[status]}>
      <span
        className={
          status === 'connected' ? 'mr-1.5 h-2 w-2 animate-pulse rounded-full bg-emerald-400' : 'hidden'
        }
      />
      {t(`status.${status}`)}
    </Badge>
  );
}
