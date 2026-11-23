let table: Uint32Array | undefined;
function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(data: Uint8Array, prev = 0): number {
  const t = crcTable();
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  if (!crypto?.subtle) throw new Error('当前页面不是安全上下文（HTTPS），无法计算校验值。');
  const d = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function digestBlob(blob: Blob): Promise<{ sha256: string; crc32: number; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { sha256: await sha256Hex(bytes), crc32: crc32(bytes), bytes };
}
