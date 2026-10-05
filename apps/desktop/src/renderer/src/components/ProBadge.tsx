import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';

/** "PRO" chip shown on locked features; opens the Account page. */
export function ProBadge({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const setPage = useStore((s) => s.setPage);
  return (
    <button
      type="button"
      title={t('account.proOnly')}
      onClick={(e) => {
        e.stopPropagation();
        setPage('account');
      }}
      className={`rounded bg-gradient-to-r from-brand-500 to-fuchsia-500 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white hover:brightness-110 ${className}`}
    >
      PRO
    </button>
  );
}
