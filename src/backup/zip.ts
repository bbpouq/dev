/**
 * Minimal ZIP (store method) writer and random-access reader.
 * Writing composes Blob parts, so photo bytes are never copied into one big buffer.
 * Reading parses the central directory and slices individual entries from the File.
 */
import { crc32 } from '../util/hash';

const enc = new TextEncoder();
const MAX_ENTRIES = 60000;

export interface ZipInput { name: string; data: Blob; crc: number; size: number; }

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function buildZip(entries: ZipInput[], when = new Date()): Blob {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosTime(when);
  for (const e of entries) {
    if (e.size !== e.data.size) throw new Error(`大小不一致：${e.name}`);
    if (offset + e.size > 0xfffffff0) throw new Error('单卷超过 4 GB，请减小分卷大小');
    const name = enc.encode(e.name);
    const lh = new Uint8Array(30 + name.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true);
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, e.crc, true);
    v.setUint32(18, e.size, true);
    v.setUint32(22, e.size, true);
    v.setUint16(26, name.length, true);
    v.setUint16(28, 0, true);
    lh.set(name, 30);
    parts.push(lh as BlobPart, e.data);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + e.size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end as BlobPart], { type: 'application/zip' });
}

export function textEntry(name: string, text: string): ZipInput {
  const bytes = enc.encode(text);
  return { name, data: new Blob([bytes as BlobPart]), crc: crc32(bytes), size: bytes.length };
}

export interface ZipEntry { name: string; method: number; crc: number; compSize: number; size: number; offset: number; }

export class ZipError extends Error {}

export class ZipReader {
  entries = new Map<string, ZipEntry>();
  constructor(private file: Blob) {}

  static async open(file: Blob): Promise<ZipReader> {
    const z = new ZipReader(file);
    await z.parse();
    return z;
  }

  private async parse() {
    const f = this.file;
    if (f.size < 22) throw new ZipError('文件太小，不是有效的备份');
    const tailLen = Math.min(f.size, 22 + 0xffff);
    const tail = new Uint8Array(await f.slice(f.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
    }
    if (eocd < 0) throw new ZipError('找不到 ZIP 目录，文件可能不完整或已损坏');
    const v = new DataView(tail.buffer, tail.byteOffset + eocd);
    const count = v.getUint16(10, true);
    const cdSize = v.getUint32(12, true);
    const cdOff = v.getUint32(16, true);
    if (count === 0xffff || cdOff === 0xffffffff) throw new ZipError('不支持 ZIP64 备份');
    if (count > MAX_ENTRIES) throw new ZipError('ZIP 条目数量异常');
    if (cdOff + cdSize > f.size) throw new ZipError('ZIP 目录超出文件范围，文件可能被截断');
    const cd = new Uint8Array(await f.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const cv = new DataView(cd.buffer);
    const dec = new TextDecoder('utf-8', { fatal: false });
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cv.getUint32(p, true) !== 0x02014b50) throw new ZipError('ZIP 目录损坏');
      const method = cv.getUint16(p + 10, true);
      const crc = cv.getUint32(p + 16, true);
      const compSize = cv.getUint32(p + 20, true);
      const size = cv.getUint32(p + 24, true);
      const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
      const offset = cv.getUint32(p + 42, true);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
      if (this.entries.has(name)) throw new ZipError(`ZIP 中有重复条目：${name}`);
      if (offset + compSize > f.size) throw new ZipError(`条目超出文件范围：${name}`);
      this.entries.set(name, { name, method, crc, compSize, size, offset });
      p += 46 + nl + xl + cl;
    }
  }

  /** Reads an entry; enforces a hard size limit before inflating anything. */
  async read(name: string, maxSize: number): Promise<Uint8Array> {
    const e = this.entries.get(name);
    if (!e) throw new ZipError(`缺少文件：${name}`);
    if (e.size > maxSize || e.compSize > maxSize) throw new ZipError(`文件大小异常：${name}`);
    const lh = new DataView(await this.file.slice(e.offset, e.offset + 30).arrayBuffer());
    if (lh.getUint32(0, true) !== 0x04034b50) throw new ZipError(`条目头损坏：${name}`);
    const start = e.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = new Uint8Array(await this.file.slice(start, start + e.compSize).arrayBuffer());
    if (raw.length !== e.compSize) throw new ZipError(`条目被截断：${name}`);
    let out: Uint8Array;
    if (e.method === 0) out = raw;
    else if (e.method === 8) {
      const { inflateSync } = await import('fflate');
      out = inflateSync(raw, { out: new Uint8Array(e.size) });
    } else throw new ZipError(`不支持的压缩方式：${name}`);
    if (out.length !== e.size) throw new ZipError(`解压大小不符：${name}`);
    if (crc32(out) !== e.crc) throw new ZipError(`CRC 校验失败：${name}`);
    return out;
  }
}
