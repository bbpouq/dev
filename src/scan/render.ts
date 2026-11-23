import type { EditParams } from '../types';
import { canvasToJpeg, decodeOriented, exifOrientation, makeThumb, pixelsToCanvas, sniffType, toPixels } from './decode';
import { masterSize, processPixels, type Pixels } from './process';
import { detectCorners } from './detect';
import { FULL_QUAD } from './geometry';

export interface Source {
  kind: ReturnType<typeof sniffType>;
  orientation: number;
  width: number;
  height: number;
  full: Pixels;
  preview: Pixels; // ≤ 1600 px long edge, same normalized coordinates
}

export const PREVIEW_MAX = 1600;

export async function loadSource(blob: Blob): Promise<Source> {
  const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const kind = sniffType(head);
  const img = await decodeOriented(blob, kind);
  const full = toPixels(img);
  const preview = toPixels(img, PREVIEW_MAX);
  if ('close' in img) img.close();
  return { kind, orientation: kind === 'jpeg' ? exifOrientation(head) : 1, width: full.width, height: full.height, full, preview };
}

export function defaultParams(src: Source): EditParams {
  const small = scaleDown(src.preview, 256);
  const q = detectCorners(small);
  return { corners: q ?? FULL_QUAD.map((p) => [...p]) as EditParams['corners'], rotation: 0, color: 'original', brightness: 0, contrast: 0, autoDetected: !!q };
}

export function autoCorners(src: Source) {
  return detectCorners(scaleDown(src.preview, 256));
}

function scaleDown(p: Pixels, maxLong: number): Pixels {
  const s = Math.min(1, maxLong / Math.max(p.width, p.height));
  if (s === 1) return p;
  const w = Math.max(1, Math.round(p.width * s)), h = Math.max(1, Math.round(p.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  // area-average downsample
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x / s), x1 = Math.min(p.width, Math.floor((x + 1) / s));
    const y0 = Math.floor(y / s), y1 = Math.min(p.height, Math.floor((y + 1) / s));
    let r = 0, g = 0, b = 0, c = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * p.width + xx) * 4;
      r += p.data[i]; g += p.data[i + 1]; b += p.data[i + 2]; c++;
    }
    const o = (y * w + x) * 4;
    out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c; out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

/** Preview of the processed result using the exact master chain at reduced size. */
export function renderPreview(src: Source, p: EditParams, maxLong = 900): HTMLCanvasElement {
  const { w, h } = masterSize(src.preview.width, src.preview.height, p.corners, maxLong);
  return pixelsToCanvas(processPixels(src.preview, p, w, h));
}

export async function renderMaster(src: Source, p: EditParams) {
  const { w, h } = masterSize(src.full.width, src.full.height, p.corners);
  const out = processPixels(src.full, p, w, h);
  const canvas = pixelsToCanvas(out);
  const master = await canvasToJpeg(canvas, 0.92);
  const thumb = await makeThumb(canvas);
  return { master, thumb, width: out.width, height: out.height };
}
