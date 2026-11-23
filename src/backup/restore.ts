import { ZipReader, ZipError } from './zip';
import { FORMAT, MAX_MANIFEST_BYTES, validateManifest, type Manifest, type VolumeInfo } from './format';
import { abortStaging, beginStaging, commitStaging } from '../db/archive';
import { isQuotaError, req, txDone } from '../db/idb';
import { sha256Hex, crc32 } from '../util/hash';
import { makeThumb } from '../scan/decode';
import { newId } from '../util/id';
import type { Asset } from '../types';

export interface RestorePlan {
  manifest: Manifest;
  readers: Map<number, ZipReader>;
  missing: number[];
  totalBytes: number;
  neededBytes: number;
  available?: number;
  errors: string[];
}

const dec = new TextDecoder();

export async function inspectBackup(files: File[]): Promise<RestorePlan> {
  const errors: string[] = [];
  const readers = new Map<number, ZipReader>();
  let manifestText: string | undefined;
  let info0: VolumeInfo | undefined;
  for (const f of files) {
    let z: ZipReader, info: VolumeInfo;
    try {
      z = await ZipReader.open(f);
      info = JSON.parse(dec.decode(await z.read('volume.json', 64 * 1024)));
    } catch (e) {
      throw new Error(`「${f.name}」不是有效的家影备份分卷：${(e as Error).message}`);
    }
    if (info.format !== FORMAT) throw new Error(`「${f.name}」不是家影备份文件`);
    if (info0 && info.exportId !== info0.exportId) throw new Error('所选文件来自不同的备份，请只选择同一次备份的分卷');
    if (info0 && info.volumeCount !== info0.volumeCount) throw new Error('分卷信息不一致');
    if (readers.has(info.volume)) throw new Error(`重复选择了第 ${info.volume} 卷`);
    const text = dec.decode(await z.read('manifest.json', MAX_MANIFEST_BYTES));
    if (manifestText !== undefined && text !== manifestText) throw new Error(`第 ${info.volume} 卷的清单与其他分卷不一致`);
    manifestText = text;
    info0 ??= info;
    readers.set(info.volume, z);
  }
  if (!manifestText || !info0) throw new Error('请选择备份文件');
  let manifest: Manifest;
  try { manifest = JSON.parse(manifestText); } catch { throw new Error('备份清单损坏，无法解析'); }
  const problems = validateManifest(manifest);
  if (problems.length) {
    return { manifest, readers, missing: [], totalBytes: 0, neededBytes: 0, errors: problems.slice(0, 20) };
  }
  if (manifest.volumeCount !== info0.volumeCount || manifest.exportId !== info0.exportId) errors.push('分卷信息与清单不一致');
  const missing: number[] = [];
  for (let k = 1; k <= manifest.volumeCount; k++) if (!readers.has(k)) missing.push(k);

  // Each present volume must hold exactly its assets with the declared sizes (no surprise entries).
  for (const [k, z] of readers) {
    const expected = manifest.assets.filter((a) => a.volume === k);
    const allowed = new Set(['volume.json', 'manifest.json', ...expected.map((a) => a.path)]);
    for (const name of z.entries.keys()) if (!allowed.has(name)) errors.push(`第 ${k} 卷含有清单外的文件：${name}`);
    for (const a of expected) {
      const e = z.entries.get(a.path);
      if (!e) errors.push(`第 ${k} 卷缺少文件：${a.path}`);
      else if (e.size !== a.size) errors.push(`文件大小与清单不符：${a.path}`);
    }
  }
  const totalBytes = manifest.totals.assetBytes;
  // Thumbnails are rebuilt (~80 KB each) plus 10% headroom for database overhead.
  const neededBytes = Math.ceil(totalBytes * 1.1 + manifest.photos.length * 80 * 1024 + manifestText.length * 2);
  let available: number | undefined;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota !== undefined) available = est.quota - (est.usage ?? 0);
  } catch { /* unknown */ }
  if (available !== undefined && available < neededBytes)
    errors.push(`设备可用空间不足：约需 ${fmtBytes(neededBytes)}，当前可用约 ${fmtBytes(available)}。请先清理空间，原档案未受影响。`);
  return { manifest, readers, missing, totalBytes, neededBytes, available, errors };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export interface Progress { done: number; total: number; label: string }

/**
 * Restores into a fresh staging database, verifies everything, then switches the
 * current-archive pointer in one write. Any failure deletes the staging copy and
 * leaves the current archive untouched.
 */
export async function executeRestore(plan: RestorePlan, currentId: string, onProgress: (p: Progress) => void): Promise<void> {
  if (plan.errors.length || plan.missing.length) throw new Error('备份未通过检查');
  const m = plan.manifest;
  const { id: stagingId, db } = await beginStaging();
  try {
    const thumbs = new Map<string, string>();
    const masterToPhoto = new Map(m.photos.map((p) => [p.masterAssetId, p.id]));
    const total = m.assets.length;
    let done = 0;
    for (const a of [...m.assets].sort((x, y) => x.volume - y.volume)) {
      onProgress({ done, total, label: `正在校验并写入第 ${a.volume}/${m.volumeCount} 卷` });
      const bytes = await plan.readers.get(a.volume)!.read(a.path, a.size);
      if (bytes.length !== a.size) throw new ZipError(`文件大小不符：${a.path}`);
      const sha = await sha256Hex(bytes);
      if (sha !== a.sha256) throw new ZipError(`校验值不符，文件已损坏：${a.path}`);
      const blob = new Blob([bytes as BlobPart], { type: a.type });
      const rows: Asset[] = [{ id: a.id, purpose: a.purpose, type: a.type, size: a.size, blob, sha256: sha, crc32: crc32(bytes) }];
      if (a.purpose === 'master') {
        let bmp: ImageBitmap;
        try { bmp = await createImageBitmap(blob); } catch { throw new ZipError(`母版无法解码：${a.path}`); }
        const t = await makeThumb(bmp);
        bmp.close();
        const tid = newId();
        thumbs.set(masterToPhoto.get(a.id)!, tid);
        rows.push({ id: tid, purpose: 'thumb', type: 'image/jpeg', size: t.size, blob: t });
      }
      const tx = db.transaction('assets', 'readwrite');
      for (const r of rows) tx.objectStore('assets').put(r);
      await txDone(tx);
      done++;
    }
    onProgress({ done, total, label: '正在写入人物与关系' });
    const tx = db.transaction(['persons', 'relationships', 'photos', 'photoPersons', 'settings'], 'readwrite');
    for (const p of m.persons) tx.objectStore('persons').put(p);
    for (const r of m.relationships) tx.objectStore('relationships').put(r);
    for (const p of m.photos) tx.objectStore('photos').put({ ...p, thumbAssetId: thumbs.get(p.id)! });
    for (const t of m.photoPersons) tx.objectStore('photoPersons').put({ photoId: t.photoId, personId: t.personId });
    tx.objectStore('settings').put({ meId: m.meId, lastBackupAt: Date.parse(m.exportedAt) || undefined, entryNoticeDismissed: true }, 'settings');
    await txDone(tx);

    // Read-back verification before switching.
    const vt = db.transaction(['persons', 'relationships', 'photos', 'photoPersons', 'assets']);
    const [np, nr, nph, npp, na] = await Promise.all([
      req(vt.objectStore('persons').count()), req(vt.objectStore('relationships').count()),
      req(vt.objectStore('photos').count()), req(vt.objectStore('photoPersons').count()), req(vt.objectStore('assets').count()),
    ]);
    if (np !== m.persons.length || nr !== m.relationships.length || nph !== m.photos.length || npp !== m.photoPersons.length || na !== m.assets.length + m.photos.length)
      throw new Error('写入后的核对结果与备份不一致');
    db.close();
    await commitStaging(stagingId, currentId);
  } catch (e) {
    await abortStaging(stagingId, db).catch(() => {});
    if (isQuotaError(e)) throw new Error('设备存储空间不足，恢复已取消，原档案未受影响。');
    throw e;
  }
}
