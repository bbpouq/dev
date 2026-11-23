import { describe, expect, it } from 'vitest';
import { buildZip, textEntry, ZipReader } from '../src/backup/zip';
import { validateManifest, FORMAT, SCHEMA_VERSION, type Manifest } from '../src/backup/format';
import { crc32 } from '../src/util/hash';
import { makeRel } from '../src/family/graph';
import { isTodo, formatDate, isValidDate } from '../src/util/date';
import type { Photo } from '../src/types';

const sha = 'a'.repeat(64);
function photo(id: string, o: string, m: string): Photo {
  return {
    id, originalAssetId: o, masterAssetId: m, thumbAssetId: '', originalName: 'x.jpg', originalType: 'image/jpeg', exifOrientation: 1,
    width: 10, height: 10, edit: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], rotation: 0, color: 'original', brightness: 0, contrast: 0 },
    template: { kind: 'plain', title: '', showDate: true, showPeople: false }, date: { precision: 'approx', value: '2002' },
    title: '', place: '', notes: '', organized: false, createdAt: 0, scannedAt: 0, updatedAt: 0,
  };
}
function manifest(): Manifest {
  return {
    format: FORMAT, schemaVersion: SCHEMA_VERSION, archiveId: 'arch', exportId: 'exp1', exportedAt: new Date().toISOString(), app: 't', volumeCount: 1,
    meId: 'p1',
    persons: [{ id: 'p1', displayName: '我', createdAt: 0 }, { id: 'p2', displayName: '妈妈', createdAt: 0 }],
    relationships: [makeRel('parent_of', 'p2', 'p1')],
    photos: [photo('ph1', 'a1', 'a2')],
    photoPersons: [{ photoId: 'ph1', personId: 'p1' }],
    assets: [
      { id: 'a1', purpose: 'original', type: 'image/jpeg', size: 3, sha256: sha, path: 'assets/a1.jpg', volume: 1 },
      { id: 'a2', purpose: 'master', type: 'image/jpeg', size: 4, sha256: sha, path: 'assets/a2.jpg', volume: 1 },
    ],
    totals: { photos: 1, persons: 2, relationships: 1, assetBytes: 7 },
  };
}

describe('manifest validation', () => {
  it('accepts a good manifest', () => expect(validateManifest(manifest())).toEqual([]));
  it('rejects unsupported versions and foreign files', () => {
    expect(validateManifest({ ...manifest(), schemaVersion: 99 })[0]).toMatch(/版本/);
    expect(validateManifest({ format: 'x' })[0]).toMatch(/不是/);
  });
  it('rejects path traversal and duplicates', () => {
    const m = manifest(); m.assets[0].path = 'assets/../../evil.jpg';
    expect(validateManifest(m).join()).toMatch(/不安全/);
    const d = manifest(); d.persons.push({ ...d.persons[0] });
    expect(validateManifest(d).join()).toMatch(/人物重复/);
  });
  it('rejects broken references and cycles', () => {
    const m = manifest(); m.photoPersons.push({ photoId: 'ph1', personId: 'ghost' });
    expect(validateManifest(m).join()).toMatch(/不存在/);
    const c = manifest(); c.relationships.push(makeRel('parent_of', 'p1', 'p2'));
    expect(validateManifest(c).join()).toMatch(/祖先/);
    const a = manifest(); a.photos[0].masterAssetId = 'nope';
    expect(validateManifest(a).join()).toMatch(/母版/);
  });
});

describe('zip', () => {
  it('round-trips stored entries and detects corruption', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const zip = buildZip([textEntry('manifest.json', '{"a":"家"}'), { name: 'assets/x.bin', data: new Blob([bytes]), crc: crc32(bytes), size: 5 }]);
    const z = await ZipReader.open(zip);
    expect([...z.entries.keys()]).toEqual(['manifest.json', 'assets/x.bin']);
    expect(new TextDecoder().decode(await z.read('manifest.json', 100))).toBe('{"a":"家"}');
    expect([...(await z.read('assets/x.bin', 5))]).toEqual([1, 2, 3, 4, 5]);
    await expect(z.read('assets/x.bin', 4)).rejects.toThrow(/大小异常/);

    const buf = new Uint8Array(await zip.arrayBuffer());
    let idx = -1; // locate the x.bin payload and flip a byte
    for (let i = 0; i < buf.length - 5; i++) if (buf[i] === 1 && buf[i + 1] === 2 && buf[i + 2] === 3 && buf[i + 3] === 4) { idx = i + 2; break; }
    const evil = buf.slice(); evil[idx] = 99;
    const z2 = await ZipReader.open(new Blob([evil]));
    await expect(z2.read('assets/x.bin', 5)).rejects.toThrow(/CRC/);
    await expect(ZipReader.open(new Blob([buf.slice(0, buf.length - 30)]))).rejects.toThrow();
  });
});

describe('dates and 待整理', () => {
  it('formats precision', () => {
    expect(formatDate({ precision: 'approx', value: '2002' })).toBe('约 2002 年');
    expect(formatDate({ precision: 'decade', value: '1980' })).toBe('1980 年代');
    expect(formatDate({ precision: 'unknown' })).toBe('年代未知');
    expect(isValidDate({ precision: 'exact', value: '2001-02-30' })).toBe(false);
    expect(isValidDate({ precision: 'decade', value: '1985' })).toBe(false);
  });
  it('todo = missing year or people unless manually organized', () => {
    const p = photo('a', 'b', 'c');
    expect(isTodo(p, 0)).toBe(true);
    expect(isTodo(p, 1)).toBe(false);
    expect(isTodo({ ...p, date: { precision: 'unknown' } }, 2)).toBe(true);
    expect(isTodo({ ...p, date: { precision: 'unknown' }, organized: true }, 0)).toBe(false);
  });
});
