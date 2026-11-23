import type { Repo } from '../db/repo';
import type { Asset } from '../types';
import { buildZip, textEntry, type ZipInput } from './zip';
import { FORMAT, SCHEMA_VERSION, extFor, volumeFileName, type Manifest, type ManifestAsset, type VolumeInfo } from './format';
import { newId } from '../util/id';
import { digestBlob } from '../util/hash';
import { APP_NAME } from '../version';

export const DEFAULT_VOLUME_BYTES = 200 * 1024 * 1024;

export interface ExportPlan {
  manifest: Manifest;
  volumes: { index: number; bytes: number; assetIds: string[]; fileName: string }[];
  assets: Map<string, Asset>;
  excludedDrafts: number;
  excludedTrash: number;
}

export async function planExport(repo: Repo, volumeLimit = DEFAULT_VOLUME_BYTES): Promise<ExportPlan> {
  const s = repo.state;
  const photos = s.photos.filter((p) => !p.trashedAt);
  const photoIds = new Set(photos.map((p) => p.id));
  const assets = new Map<string, Asset>();
  for (const p of photos) {
    for (const id of [p.originalAssetId, p.masterAssetId]) {
      const a = await repo.getAsset(id);
      if (!a) throw new Error(`本机档案缺少照片文件（${p.title || p.originalName}），请重新编辑或删除该照片后再备份。`);
      if (!a.sha256 || a.crc32 === undefined) {
        const d = await digestBlob(a.blob);
        a.sha256 = d.sha256; a.crc32 = d.crc32;
      }
      assets.set(id, a);
    }
  }
  const exportedAt = new Date();
  const volumes: ExportPlan['volumes'] = [];
  let cur: ExportPlan['volumes'][number] | undefined;
  const mAssets: ManifestAsset[] = [];
  for (const p of photos) {
    const pair = [assets.get(p.originalAssetId)!, assets.get(p.masterAssetId)!];
    const size = pair[0].size + pair[1].size;
    if (!cur || (cur.bytes + size > volumeLimit && cur.assetIds.length)) {
      cur = { index: volumes.length + 1, bytes: 0, assetIds: [], fileName: '' };
      volumes.push(cur);
    }
    for (const a of pair) {
      cur.assetIds.push(a.id);
      cur.bytes += a.size;
      mAssets.push({ id: a.id, purpose: a.purpose as 'original' | 'master', type: a.type, size: a.size, sha256: a.sha256!, path: `assets/${a.id}.${extFor(a.type)}`, volume: cur.index });
    }
  }
  if (!volumes.length) volumes.push({ index: 1, bytes: 0, assetIds: [], fileName: '' });
  for (const v of volumes) v.fileName = volumeFileName(exportedAt, v.index, volumes.length);

  const photoPersons = s.photoPersons.filter((t) => photoIds.has(t.photoId));
  const manifest: Manifest = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    archiveId: s.archiveId,
    exportId: newId(),
    exportedAt: exportedAt.toISOString(),
    app: APP_NAME,
    volumeCount: volumes.length,
    meId: s.settings.meId,
    persons: s.persons,
    relationships: s.rels,
    photos: photos.map((p) => ({ ...p, thumbAssetId: '' })),
    photoPersons,
    assets: mAssets,
    totals: { photos: photos.length, persons: s.persons.length, relationships: s.rels.length, assetBytes: mAssets.reduce((t, a) => t + a.size, 0) },
  };
  return {
    manifest, volumes, assets,
    excludedDrafts: s.drafts.length,
    excludedTrash: s.photos.length - photos.length,
  };
}

export function buildVolume(plan: ExportPlan, index: number): Blob {
  const v = plan.volumes[index - 1];
  const info: VolumeInfo = { format: FORMAT, exportId: plan.manifest.exportId, volume: index, volumeCount: plan.volumes.length };
  const byId = new Map(plan.manifest.assets.map((a) => [a.id, a]));
  const entries: ZipInput[] = [
    textEntry('volume.json', JSON.stringify(info)),
    textEntry('manifest.json', JSON.stringify(plan.manifest)),
  ];
  for (const id of v.assetIds) {
    const a = plan.assets.get(id)!;
    entries.push({ name: byId.get(id)!.path, data: a.blob, crc: a.crc32!, size: a.size });
  }
  return buildZip(entries, new Date(plan.manifest.exportedAt));
}
