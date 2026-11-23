import type { EditParams, Quad } from '../types';
import { homography, quadOutputSize } from './geometry';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

export const MASTER_MAX = 4096;

/** Pixel size of the master for a source of the given size (before rotation). */
export function masterSize(srcW: number, srcH: number, corners: Quad, maxLong = MASTER_MAX) {
  const q = corners.map(([x, y]) => [x * srcW, y * srcH]) as Quad;
  const { w, h } = quadOutputSize(q);
  const s = Math.min(1, maxLong / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * The single processing chain used by preview and master:
 * perspective warp (corners in oriented source) → 90° rotation → colour / tone.
 * `outW/outH` is the pre-rotation output size; preview passes a smaller size.
 */
export function processPixels(src: Pixels, p: EditParams, outW: number, outH: number): Pixels {
  const sw = src.width, sh = src.height, sd = src.data;
  const quadPx = p.corners.map(([x, y]) => [x * sw, y * sh]) as Quad;
  const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quadPx);
  const rot = p.rotation;
  const W = rot === 90 || rot === 270 ? outH : outW;
  const Hh = rot === 90 || rot === 270 ? outW : outH;
  const out = new Uint8ClampedArray(W * Hh * 4);

  // Tone curve LUT: contrast around mid-grey then brightness offset.
  const c = Math.max(-100, Math.min(100, p.contrast)) * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const bo = Math.max(-100, Math.min(100, p.brightness)) * 1.28;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = cf * (i - 128) + 128 + bo;
  const bw = p.color === 'bw';

  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
  for (let y = 0; y < outH; y++) {
    const yc = y + 0.5;
    for (let x = 0; x < outW; x++) {
      const xc = x + 0.5;
      const w = h6 * xc + h7 * yc + h8;
      let sx = (h0 * xc + h1 * yc + h2) / w - 0.5;
      let sy = (h3 * xc + h4 * yc + h5) / w - 0.5;
      if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1;
      if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;
      const x0 = sx | 0, y0 = sy | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      let r = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      let g = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      let b = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      if (bw) r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
      // rotate destination
      let dx: number, dy: number;
      if (rot === 0) { dx = x; dy = y; }
      else if (rot === 90) { dx = outH - 1 - y; dy = x; }
      else if (rot === 180) { dx = outW - 1 - x; dy = outH - 1 - y; }
      else { dx = y; dy = outW - 1 - x; }
      const o = (dy * W + dx) * 4;
      out[o] = lut[(r + 0.5) | 0];
      out[o + 1] = lut[(g + 0.5) | 0];
      out[o + 2] = lut[(b + 0.5) | 0];
      out[o + 3] = 255;
    }
  }
  return { width: W, height: Hh, data: out };
}
