import type { Pt, Quad } from '../types';
import type { Pixels } from './process';
import { isConvexQuad, orderQuad } from './geometry';

/**
 * Suggests the four corners of a single physical photo lying on a background.
 * Works on a small (≈256 px) copy: estimates the background colour from the image
 * border, thresholds colour distance (Otsu), keeps the largest connected blob,
 * then fits the max-area quadrilateral on its convex hull.
 * Returns normalized corners, or null when nothing convincing is found.
 */
export function detectCorners(img: Pixels): Quad | null {
  const { width: W, height: H, data } = img;
  if (W < 16 || H < 16) return null;
  const n = W * H;

  // Light blur via 3x3 box on RGB → separate float arrays
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = (yy * W + xx) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
    }
    const k = y * W + x;
    R[k] = r / c; G[k] = g / c; B[k] = b / c;
  }

  // Background: per-channel median of a 3% border frame.
  const m = Math.max(2, Math.round(Math.min(W, H) * 0.03));
  const br: number[] = [], bg: number[] = [], bb: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= m && y >= m && x < W - m && y < H - m) continue;
    const k = y * W + x;
    br.push(R[k]); bg.push(G[k]); bb.push(B[k]);
  }
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const mr = med(br), mg = med(bg), mb = med(bb);

  const dist = new Float32Array(n);
  let maxD = 1;
  for (let k = 0; k < n; k++) {
    const d = Math.hypot(R[k] - mr, G[k] - mg, B[k] - mb);
    dist[k] = d;
    if (d > maxD) maxD = d;
  }
  // Otsu threshold on distance histogram
  const hist = new Array(256).fill(0);
  for (let k = 0; k < n; k++) hist[Math.min(255, Math.floor((dist[k] / maxD) * 255))]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  const t = Math.max((thr / 255) * maxD, 18);
  let mask: Uint8Array = new Uint8Array(n);
  for (let k = 0; k < n; k++) mask[k] = dist[k] > t ? 1 : 0;
  mask = morph(morph(mask, W, H, false), W, H, true); // open: remove specks
  mask = morph(morph(mask, W, H, true), W, H, false); // close: fill gaps

  // Largest 4-connected component
  const label = new Int32Array(n);
  let bestLabel = 0, bestSize = 0, cur = 0;
  const stack: number[] = [];
  for (let k = 0; k < n; k++) {
    if (!mask[k] || label[k]) continue;
    cur++;
    let size = 0;
    stack.push(k);
    label[k] = cur;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % W, y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && mask[j] && !label[j]) { label[j] = cur; stack.push(j); }
    }
    if (size > bestSize) { bestSize = size; bestLabel = cur; }
  }
  if (bestSize < n * 0.08 || bestSize > n * 0.97) return null;

  // Boundary points → convex hull
  const pts: Pt[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (label[k] !== bestLabel) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
      label[k - 1] !== bestLabel || label[k + 1] !== bestLabel || label[k - W] !== bestLabel || label[k + W] !== bestLabel) {
      pts.push([x + 0.5, y + 0.5]);
    }
  }
  let hull = convexHull(pts);
  if (hull.length < 4) return null;
  hull = simplify(hull, 24);
  const quad = maxAreaQuad(hull);
  if (!quad) return null;
  const area = polyArea(quad);
  // The blob should fill its quad reasonably (it is a rectangle-ish photo).
  if (area < n * 0.08 || bestSize / area < 0.8) return null;
  const q = orderQuad(quad).map(([x, y]) => [clamp01(x / W), clamp01(y / H)]) as Quad;
  return isConvexQuad(q) ? q : null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function morph(m: Uint8Array, W: number, H: number, dilate: boolean): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = dilate ? 0 : 1;
    for (let dy = -1; dy <= 1 && v === (dilate ? 0 : 1); dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
      const s = m[yy * W + xx];
      if (dilate && s) { v = 1; break; }
      if (!dilate && !s) { v = 0; break; }
    }
    out[y * W + x] = v;
  }
  return out;
}

function cross(o: Pt, a: Pt, b: Pt) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }

export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Drop the hull vertex contributing least area until at most `max` remain. */
function simplify(h: Pt[], max: number): Pt[] {
  const pts = [...h];
  while (pts.length > max) {
    let mi = 0, ma = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const ar = Math.abs(cross(a, b, c));
      if (ar < ma) { ma = ar; mi = i; }
    }
    pts.splice(mi, 1);
  }
  return pts;
}

function polyArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

function maxAreaQuad(h: Pt[]): Pt[] | null {
  const n = h.length;
  let best: Pt[] | null = null, bestA = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
    const q = [h[i], h[j], h[k], h[l]];
    const a = polyArea(q);
    if (a > bestA) { bestA = a; best = q; }
  }
  return best;
}
