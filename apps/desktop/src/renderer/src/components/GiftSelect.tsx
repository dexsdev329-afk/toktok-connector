import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { cx } from './ui';

const isKick = (id: string) => id.startsWith('kick:');

/** Gift value with its unit: diamonds on TikTok, Kicks on Kick. */
function GiftValue({ id, value }: { id: string; value: number }) {
  return isKick(id) ? (
    <span className="text-xs text-slate-400 tabular-nums">
      <span className="mr-1 rounded bg-green-500/20 px-1 text-[10px] font-semibold text-green-300">KICK</span>
      {value} K
    </span>
  ) : (
    <span className="text-xs text-slate-400 tabular-nums">{value} 💎</span>
  );
}

/** Searchable gift picker showing image, name and value. */
export function GiftSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const gifts = useStore((s) => s.gifts);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = gifts.find((g) => g.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? gifts.filter((g) => g.name.toLowerCase().includes(q) || g.id === q) : gifts;
  }, [gifts, query]);

  return (
    <div
      className="relative"
      ref={ref}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-left text-sm focus:border-brand-500 focus:outline-none"
      >
        {selected?.imageUrl ? (
          <img src={selected.imageUrl} alt="" className="h-6 w-6 object-contain" />
        ) : (
          <span className="h-6 w-6" />
        )}
        <span className="flex-1 truncate">{selected ? selected.name : value || '—'}</span>
        {selected && <GiftValue id={selected.id} value={selected.diamonds} />}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-64 rounded-lg border border-ink-700 bg-ink-900 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍"
            className="w-full border-b border-ink-700 bg-transparent px-3 py-2 text-sm focus:outline-none"
          />
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.slice(0, 300).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  onChange(g.id);
                  setOpen(false);
                  setQuery('');
                }}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-800',
                  g.id === value && 'bg-brand-500/15',
                )}
              >
                {g.imageUrl ? (
                  <img src={g.imageUrl} alt="" loading="lazy" className="h-6 w-6 object-contain" />
                ) : (
                  <span className="h-6 w-6" />
                )}
                <span className="flex-1 truncate">{g.name}</span>
                <GiftValue id={g.id} value={g.diamonds} />
              </button>
            ))}
            {filtered.length === 0 && query.trim() && (
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-ink-800"
                onClick={() => {
                  onChange(query.trim());
                  setOpen(false);
                }}
              >
                ID « {query.trim()} »
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
