import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Signal, useSignal } from './store';

interface Ask { message: string; detail?: string; ok: string; danger?: boolean; resolve: (v: boolean) => void }
const askSignal = new Signal<Ask | null>(null);

/** Promise-based confirm dialog. */
export function confirmDialog(message: string, opts: { detail?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => askSignal.set({ message, detail: opts.detail, ok: opts.ok ?? '确定', danger: opts.danger, resolve }));
}

export function DialogHost() {
  const a = useSignal(askSignal);
  if (!a) return null;
  const done = (v: boolean) => { askSignal.set(null); a.resolve(v); };
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && done(false)}>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label={a.message}>
        <p class="dialog-msg">{a.message}</p>
        {a.detail && <p class="muted">{a.detail}</p>}
        <div class="row end">
          <button class="btn" onClick={() => done(false)}>取消</button>
          <button class={a.danger ? 'btn danger' : 'btn primary'} onClick={() => done(true)}>{a.ok}</button>
        </div>
      </div>
    </div>
  );
}

export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [props.onClose]);
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={'sheet' + (props.wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="sheet-head">
          <h2>{props.title}</h2>
          <button class="btn ghost" aria-label="关闭" onClick={props.onClose}>✕</button>
        </div>
        <div class="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(f: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return;
    setBusy(true);
    try { return await f(); } finally { setBusy(false); }
  };
  return [busy, run] as const;
}
