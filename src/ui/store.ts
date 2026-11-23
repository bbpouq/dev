import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Repo } from '../db/repo';

export const RepoCtx = createContext<Repo>(null as unknown as Repo);

/** Returns the repo and re-renders whenever its state reloads. */
export function useRepo(): Repo {
  const repo = useContext(RepoCtx);
  const [, setV] = useState(0);
  useEffect(() => repo.subscribe(() => setV((v) => v + 1)), [repo]);
  return repo;
}

// ---- hash router ----
export function useRoute(): string[] {
  const get = () => (location.hash.replace(/^#\/?/, '') || 'album').split('/').map(decodeURIComponent);
  const [r, setR] = useState(get);
  useEffect(() => {
    const f = () => setR(get());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}
export const go = (path: string) => { location.hash = '#/' + path; };

// ---- small global signals ----
type Sub<T> = (v: T) => void;
export class Signal<T> {
  private subs = new Set<Sub<T>>();
  constructor(public value: T) {}
  set(v: T) { this.value = v; for (const s of this.subs) s(v); }
  sub(f: Sub<T>) { this.subs.add(f); return () => { this.subs.delete(f); }; }
}
export function useSignal<T>(s: Signal<T>): T {
  const [v, setV] = useState(s.value);
  useEffect(() => s.sub(setV), [s]);
  return v;
}

export type OfflineStatus = 'dev' | 'unsupported' | 'preparing' | 'ready' | 'failed';
export const offlineStatus = new Signal<OfflineStatus>('preparing');

export const toastSignal = new Signal<{ text: string; kind: 'info' | 'error'; id: number } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  toastSignal.set({ text, kind, id: Date.now() });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastSignal.set(null), kind === 'error' ? 6000 : 3000);
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
