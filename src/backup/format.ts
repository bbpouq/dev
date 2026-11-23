import type { Person, Photo, PhotoPerson, Relationship } from '../types';
import { validateAllRels } from '../family/graph';
import { isValidDate } from '../util/date';

export const FORMAT = 'jiaying-archive';
export const SCHEMA_VERSION = 1;
export const MAX_ASSET_BYTES = 512 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

export interface ManifestAsset {
  id: string;
  purpose: 'original' | 'master';
  type: string;
  size: number;
  sha256: string;
  path: string;
  volume: number;
}

export interface Manifest {
  format: typeof FORMAT;
  schemaVersion: number;
  archiveId: string;
  exportId: string;
  exportedAt: string;
  app: string;
  volumeCount: number;
  meId?: string;
  persons: Person[];
  relationships: Relationship[];
  photos: Photo[];
  photoPersons: PhotoPerson[];
  assets: ManifestAsset[];
  totals: { photos: number; persons: number; relationships: number; assetBytes: number };
}

export interface VolumeInfo { format: typeof FORMAT; exportId: string; volume: number; volumeCount: number }

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PATH_RE = /^assets\/[A-Za-z0-9_-]{1,64}\.(jpg|png|heic|heif|webp|gif|bin)$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export function extFor(type: string): string {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/heic') return 'heic';
  if (type === 'image/heif') return 'heif';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  return 'bin';
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Structural, reference and safety checks of a manifest. Returns a list of problems (empty = OK). */
export function validateManifest(m: unknown): string[] {
  const errs: string[] = [];
  const x = m as Manifest;
  if (!x || typeof x !== 'object') return ['清单不是有效的 JSON 对象'];
  if (x.format !== FORMAT) return ['这不是「家影」备份文件'];
  if (x.schemaVersion !== SCHEMA_VERSION) return [`备份版本 ${String(x.schemaVersion)} 不受此版本应用支持，请先更新应用`];
  for (const k of ['persons', 'relationships', 'photos', 'photoPersons', 'assets'] as const) {
    if (!Array.isArray(x[k])) return [`清单缺少 ${k}`];
  }
  if (!isInt(x.volumeCount, 1, 10000)) errs.push('分卷数无效');
  if (!isStr(x.exportId) || !ID_RE.test(x.exportId)) errs.push('备份 ID 无效');

  const assets = new Map<string, ManifestAsset>();
  const paths = new Set<string>();
  let bytes = 0;
  for (const a of x.assets) {
    if (!a || !isStr(a.id) || !ID_RE.test(a.id)) { errs.push('资源 ID 无效'); continue; }
    if (assets.has(a.id)) errs.push(`资源重复：${a.id}`);
    if (!isStr(a.path) || !PATH_RE.test(a.path) || a.path.includes('..')) errs.push(`资源路径不安全：${String(a.path)}`);
    else if (paths.has(a.path)) errs.push(`资源路径重复：${a.path}`);
    if (a.purpose !== 'original' && a.purpose !== 'master') errs.push(`资源用途无效：${a.id}`);
    if (!isInt(a.size, 1, MAX_ASSET_BYTES)) errs.push(`资源大小无效：${a.id}`);
    if (!isStr(a.sha256) || !SHA_RE.test(a.sha256)) errs.push(`资源校验值无效：${a.id}`);
    if (!isInt(a.volume, 1, x.volumeCount)) errs.push(`资源分卷号无效：${a.id}`);
    if (!isStr(a.type)) errs.push(`资源类型无效：${a.id}`);
    assets.set(a.id, a);
    paths.add(a.path);
    bytes += a.size || 0;
  }

  const personIds = new Set<string>();
  for (const p of x.persons) {
    if (!p || !isStr(p.id) || !ID_RE.test(p.id)) { errs.push('人物 ID 无效'); continue; }
    if (personIds.has(p.id)) errs.push(`人物重复：${p.id}`);
    if (!isStr(p.displayName) || !p.displayName.trim()) errs.push(`人物缺少显示名：${p.id}`);
    if (p.birthYear !== undefined && !isInt(p.birthYear, 1000, 3000)) errs.push(`出生年无效：${p.id}`);
    personIds.add(p.id);
  }
  if (x.meId !== undefined && !personIds.has(x.meId)) errs.push('中心人物「我」不存在');

  const photoIds = new Set<string>();
  const usedAssets = new Set<string>();
  for (const ph of x.photos) {
    if (!ph || !isStr(ph.id) || !ID_RE.test(ph.id)) { errs.push('照片 ID 无效'); continue; }
    if (photoIds.has(ph.id)) errs.push(`照片重复：${ph.id}`);
    photoIds.add(ph.id);
    const o = assets.get(ph.originalAssetId), ms = assets.get(ph.masterAssetId);
    if (!o || o.purpose !== 'original') errs.push(`照片缺少原件：${ph.id}`);
    if (!ms || ms.purpose !== 'master') errs.push(`照片缺少母版：${ph.id}`);
    for (const id of [ph.originalAssetId, ph.masterAssetId]) {
      if (usedAssets.has(id)) errs.push(`资源被多张照片引用：${id}`);
      usedAssets.add(id);
    }
    if (!ph.date || !isValidDate(ph.date)) errs.push(`照片日期无效：${ph.id}`);
    const c = ph.edit?.corners;
    if (!Array.isArray(c) || c.length !== 4 || c.some((pt) => !Array.isArray(pt) || pt.length !== 2 || pt.some((v) => typeof v !== 'number' || !isFinite(v))))
      errs.push(`照片编辑参数无效：${ph.id}`);
    if (![0, 90, 180, 270].includes(ph.edit?.rotation)) errs.push(`照片旋转参数无效：${ph.id}`);
    if (!ph.template || !['plain', 'border', 'story'].includes(ph.template.kind)) errs.push(`照片模板无效：${ph.id}`);
  }
  for (const a of assets.values()) if (!usedAssets.has(a.id)) errs.push(`资源未被引用：${a.id}`);

  const tags = new Set<string>();
  for (const t of x.photoPersons) {
    const k = `${t?.photoId}|${t?.personId}`;
    if (tags.has(k)) errs.push(`人物标记重复：${k}`);
    tags.add(k);
    if (!photoIds.has(t?.photoId) || !personIds.has(t?.personId)) errs.push(`人物标记引用不存在的照片或人物：${k}`);
  }

  const relErr = validateAllRels(personIds, x.relationships);
  if (relErr) errs.push(relErr);

  if (x.totals && (x.totals.photos !== x.photos.length || x.totals.persons !== x.persons.length || x.totals.assetBytes !== bytes))
    errs.push('清单汇总与内容不一致');
  return errs;
}

export function volumeFileName(exportedAt: Date, k: number, n: number) {
  const p = (v: number) => String(v).padStart(2, '0');
  const d = exportedAt;
  return `jiaying-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${k}of${n}.zip`;
}
