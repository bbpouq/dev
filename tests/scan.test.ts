import { describe, expect, it } from 'vitest';
import { applyH, homography, orderQuad, isConvexQuad } from '../src/scan/geometry';
import { masterSize, processPixels, type Pixels } from '../src/scan/process';
import { detectCorners } from '../src/scan/detect';
import { exifOrientation, sniffType } from '../src/scan/decode';
import type { EditParams, Pt } from '../src/types';

function canvas(w: number, h: number, bg: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
function inside(q: Pt[], x: number, y: number) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); }
  }
  return true;
}
function fillQuad(p: Pixels, q: Pt[], color: (x: number, y: number) => [number, number, number]) {
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (inside(q, x + 0.5, y + 0.5)) {
    const [r, g, b] = color(x, y); const i = (y * p.width + x) * 4; p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b;
  }
}

describe('geometry', () => {
  it('homography maps corners exactly', () => {
    const src: Pt[] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const dst: Pt[] = [[10, 5], [90, 12], [95, 70], [3, 60]];
    const H = homography(src, dst);
    for (let i = 0; i < 4; i++) { const [x, y] = applyH(H, ...src[i]); expect(x).toBeCloseTo(dst[i][0], 6); expect(y).toBeCloseTo(dst[i][1], 6); }
  });
  it('orders arbitrary points as TL,TR,BR,BL', () => {
    const q = orderQuad([[90, 80], [10, 10], [12, 85], [95, 8]]);
    expect(q).toEqual([[10, 10], [95, 8], [90, 80], [12, 85]]);
    expect(isConvexQuad(q)).toBe(true);
    expect(isConvexQuad([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(false);
  });
});

describe('processing chain', () => {
  const src = canvas(40, 20, [0, 0, 0]);
  // left half red, right half blue
  fillQuad(src, [[0, 0], [20, 0], [20, 20], [0, 20]], () => [255, 0, 0]);
  fillQuad(src, [[20, 0], [40, 0], [40, 20], [20, 20]], () => [0, 0, 255]);
  const base: EditParams = { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], rotation: 0, color: 'original', brightness: 0, contrast: 0 };

  it('keeps size when smaller than the 4096 cap, caps long edge otherwise', () => {
    expect(masterSize(40, 20, base.corners)).toEqual({ w: 40, h: 20 });
    expect(masterSize(8000, 6000, base.corners)).toEqual({ w: 4096, h: 3072 });
  });
  it('rotates 90° clockwise after warping', () => {
    const out = processPixels(src, { ...base, rotation: 90 }, 40, 20);
    expect([out.width, out.height]).toEqual([20, 40]);
    // left (red) half ends up on top after clockwise rotation
    expect(out.data[(2 * 20 + 10) * 4]).toBe(255);
    expect(out.data[(37 * 20 + 10) * 4 + 2]).toBe(255);
  });
  it('crops via corners and converts to grayscale', () => {
    const out = processPixels(src, { ...base, corners: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]], color: 'bw' }, 20, 20);
    const i = (10 * 20 + 10) * 4;
    expect(out.data[i]).toBe(out.data[i + 1]);
    expect(out.data[i]).toBe(Math.round(0.114 * 255));
  });
  it('brightness lifts values', () => {
    const out = processPixels(canvas(4, 4, [100, 100, 100]), { ...base, brightness: 50 }, 4, 4);
    expect(out.data[0]).toBe(164);
  });
});

describe('edge detection', () => {
  it('finds a tilted light photo on a dark table', () => {
    const p = canvas(256, 192, [40, 38, 35]);
    const q: Pt[] = [[60, 30], [210, 45], [195, 160], [45, 150]];
    fillQuad(p, q, (x, y) => [200 - ((x * 3 + y) % 60), 180 - (y % 40), 150]);
    const got = detectCorners(p)!;
    expect(got).not.toBeNull();
    got.forEach(([x, y], i) => {
      expect(Math.abs(x * 256 - q[i][0])).toBeLessThan(5);
      expect(Math.abs(y * 192 - q[i][1])).toBeLessThan(5);
    });
  });
  it('returns null for a uniform image', () => {
    expect(detectCorners(canvas(128, 96, [120, 120, 120]))).toBeNull();
  });
});

describe('decode helpers', () => {
  it('sniffs formats', () => {
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    const heic = new Uint8Array(16); heic.set([...'ftypheic'].map((c) => c.charCodeAt(0)), 4);
    expect(sniffType(heic)).toBe('heic');
  });
  it('reads EXIF orientation', () => {
    // SOI, APP1 Exif (big-endian TIFF), IFD with one Orientation=6 entry
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
    const app1 = [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0], tiff);
    const len = app1.length + 2;
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda]);
    expect(exifOrientation(b)).toBe(6);
  });
});
