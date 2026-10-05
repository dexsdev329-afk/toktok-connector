export type ToastKind = 'info' | 'success' | 'error';
export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

let next = 1;
const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];

function emit() {
  for (const l of listeners) l(items);
}

export function toast(text: string, kind: ToastKind = 'info'): void {
  const item = { id: next++, text, kind };
  items = [...items, item].slice(-4);
  emit();
  setTimeout(
    () => {
      items = items.filter((i) => i.id !== item.id);
      emit();
    },
    kind === 'error' ? 7000 : 3500,
  );
}

export function subscribeToasts(l: (items: ToastItem[]) => void): () => void {
  listeners.add(l);
  l(items);
  return () => listeners.delete(l);
}
