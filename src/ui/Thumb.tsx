import { useEffect, useRef, useState } from 'preact/hooks';
import type { Repo } from '../db/repo';

/** Object URLs for thumbnails, LRU-capped so long scrolls don't hold every image. */
const cache = new Map<string, string>();
const MAX = 400;
async function urlFor(repo: Repo, assetId: string): Promise<string | undefined> {
  const hit = cache.get(assetId);
  if (hit) { cache.delete(assetId); cache.set(assetId, hit); return hit; }
  const a = await repo.getAsset(assetId);
  if (!a) return undefined;
  const u = URL.createObjectURL(a.blob);
  cache.set(assetId, u);
  while (cache.size > MAX) {
    const [k, v] = cache.entries().next().value as [string, string];
    cache.delete(k);
    URL.revokeObjectURL(v);
  }
  return u;
}

let io: IntersectionObserver | undefined;
const visibleCbs = new WeakMap<Element, () => void>();
function observe(el: Element, cb: () => void) {
  if (typeof IntersectionObserver === 'undefined') { cb(); return () => {}; }
  io ??= new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { visibleCbs.get(e.target)?.(); io!.unobserve(e.target); }
  }, { rootMargin: '400px' });
  visibleCbs.set(el, cb);
  io.observe(el);
  return () => io!.unobserve(el);
}

export function Thumb({ repo, assetId, alt }: { repo: Repo; assetId: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    const stop = observe(ref.current!, () => { urlFor(repo, assetId).then((u) => live && setUrl(u)); });
    return () => { live = false; stop(); };
  }, [assetId]);
  return (
    <div class="thumb" ref={ref}>
      {url && <img src={url} alt={alt} decoding="async" loading="lazy" />}
    </div>
  );
}

/** Full-size asset URL with cleanup on unmount. */
export function useAssetUrl(repo: Repo, assetId: string | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!assetId) return;
    let u: string | undefined, live = true;
    repo.getAsset(assetId).then((a) => {
      if (!a || !live) return;
      u = URL.createObjectURL(a.blob);
      setUrl(u);
    });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [assetId]);
  return url;
}
