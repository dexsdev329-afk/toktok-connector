import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { subscribeToasts, type ToastItem } from '../lib/toast';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-500 hover:bg-brand-600 text-white shadow-[0_0_18px_-4px_var(--color-brand-500)]',
  secondary: 'bg-ink-700 hover:bg-ink-600 text-slate-100',
  ghost: 'hover:bg-ink-800 text-slate-300',
  danger: 'bg-red-600/80 hover:bg-red-600 text-white',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-ink-700 bg-ink-900 p-4', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-wide text-slate-200">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const fieldBase =
  'w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldBase, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={cx(fieldBase, 'font-mono text-xs leading-relaxed', props.className)} />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldBase, 'pr-8', props.className)} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-brand-500' : 'bg-ink-600',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
            checked ? 'left-4.5' : 'left-0.5',
          )}
        />
      </button>
      {label}
    </label>
  );
}

const BADGE: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  red: 'bg-red-500/15 text-red-300 ring-red-500/30',
  gray: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  pink: 'bg-brand-500/15 text-brand-400 ring-brand-500/30',
};

export function Badge({ color = 'gray', children }: { color?: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1',
        BADGE[color],
      )}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-700 p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-6 backdrop-blur-sm">
      <div
        className={cx(
          'w-full rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl',
          wide ? 'max-w-4xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-slate-400 hover:text-white" onClick={onClose} aria-label="close">
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-ink-700 px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            'rounded-lg border px-3 py-2 text-sm shadow-lg',
            t.kind === 'error' && 'border-red-500/40 bg-red-950 text-red-100',
            t.kind === 'success' && 'border-emerald-500/40 bg-emerald-950 text-emerald-100',
            t.kind === 'info' && 'border-ink-600 bg-ink-800 text-slate-100',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export { cx };
