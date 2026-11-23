import type { Pixels } from './process';

/** iOS Safari refuses canvases above ~16.7 MP. */
export const MAX_CANVAS_PIXELS = 16_000_000;

export function sniffType(b: Uint8Array): 'jpeg' | 'png' | 'heic' | 'webp' | 'gif' | 'unknown' {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 12 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand)) return 'heic';
  }
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') return 'webp';
  if (String.fromCharCode(b[0], b[1], b[2]) === 'GIF') return 'gif';
  return 'unknown';
}

/** EXIF orientation (1..8) of a JPEG; 1 when absent. */
export function exifOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) return 1;
    const marker = b[o + 1];
    const len = v.getUint16(o + 2);
    if (marker === 0xe1 && String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]) === 'Exif') {
      const t = o + 10;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const count = v.getUint16(ifd, le);
      for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > b.length) return 1;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le) || 1;
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    o += 2 + len;
  }
  return 1;
}

export class DecodeError extends Error {}

export const HEIC_HELP =
  '此浏览器无法在本机读取 HEIC/HEIF 照片。可改用「拍照」直接扫描；或在 iPhone「设置 › 相机 › 格式」选择「兼容性最佳」；也可以在「照片」中把它存为 JPEG 副本后重新选择。队列中的其他照片不受影响。';

/** Decodes with EXIF orientation applied, downscaled if beyond the canvas limit. */
export async function decodeOriented(blob: Blob, kind: ReturnType<typeof sniffType>): Promise<ImageBitmap | HTMLImageElement> {
  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    try {
      img = await loadImage(blob);
    } catch {
      if (kind === 'heic') throw new DecodeError(HEIC_HELP);
      throw new DecodeError('无法读取此文件：它可能已损坏，或不是受支持的图片格式（JPEG、PNG）。');
    }
  }
  const w = img.width, h = img.height;
  if (!w || !h) throw new DecodeError('图片尺寸无效。');
  if (w * h > MAX_CANVAS_PIXELS) {
    const s = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
    const rw = Math.floor(w * s), rh = Math.floor(h * s);
    try {
      const r = await createImageBitmap(img, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' });
      if ('close' in img) img.close();
      return r;
    } catch {
      const c = document.createElement('canvas');
      c.width = rw; c.height = rh;
      c.getContext('2d')!.drawImage(img, 0, 0, rw, rh);
      return await createImageBitmap(c);
    }
  }
  return img;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
    img.src = url;
  });
}

export function toPixels(src: CanvasImageSource & { width: number; height: number }, maxLong = Infinity): Pixels {
  const s = Math.min(1, maxLong / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

export function pixelsToCanvas(p: Pixels): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.width; c.height = p.height;
  c.getContext('2d')!.putImageData(new ImageData(p.data as unknown as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return c;
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('JPEG 编码失败'))), 'image/jpeg', quality));
}

export async function makeThumb(src: CanvasImageSource & { width: number; height: number }, maxLong = 480): Promise<Blob> {
  const s = Math.min(1, maxLong / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return canvasToJpeg(c, 0.82);
}
