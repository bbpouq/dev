import { openCurrentArchive } from './archive';
import { req, txDone } from './idb';
import type { Asset, AssetPurpose, Draft, Person, Photo, PhotoPerson, Relationship, RelType, Settings } from '../types';
import { newId } from '../util/id';
import { digestBlob } from '../util/hash';
import { Graph, REL_ERROR_TEXT, makeRel, validateRel } from '../family/graph';

export interface State {
  archiveId: string;
  photos: Photo[];
  persons: Person[];
  rels: Relationship[];
  photoPersons: PhotoPerson[];
  drafts: Draft[];
  settings: Settings;
}

type Listener = () => void;

export async function makeAsset(blob: Blob, purpose: AssetPurpose, type = blob.type): Promise<Asset> {
  const { sha256, crc32, bytes } = await digestBlob(blob);
  // Copy bytes into a fresh Blob so storage never depends on a transient File handle.
  return { id: newId(), purpose, type: type || 'application/octet-stream', size: bytes.byteLength, blob: new Blob([bytes as BlobPart], { type }), sha256, crc32 };
}

export class Repo {
  state!: State;
  private listeners = new Set<Listener>();
  constructor(public id: string, public db: IDBDatabase) {}

  static async open(): Promise<Repo> {
    const { id, db } = await openCurrentArchive();
    const r = new Repo(id, db);
    await r.reload();
    return r;
  }

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  async reload() {
    const tx = this.db.transaction(['photos', 'persons', 'relationships', 'photoPersons', 'drafts', 'settings']);
    const [photos, persons, rels, photoPersons, drafts, settings] = await Promise.all([
      req(tx.objectStore('photos').getAll()),
      req(tx.objectStore('persons').getAll()),
      req(tx.objectStore('relationships').getAll()),
      req(tx.objectStore('photoPersons').getAll()),
      req(tx.objectStore('drafts').getAll()),
      req(tx.objectStore('settings').get('settings')),
    ]);
    (drafts as Draft[]).sort((a, b) => a.seq - b.seq);
    this.state = { archiveId: this.id, photos, persons, rels, photoPersons, drafts, settings: settings ?? {} };
    for (const l of this.listeners) l();
  }

  private async write(stores: string[], fn: (tx: IDBTransaction) => void) {
    const tx = this.db.transaction(stores, 'readwrite');
    fn(tx);
    await txDone(tx);
    await this.reload();
  }

  getAsset(id: string): Promise<Asset | undefined> {
    return req(this.db.transaction('assets').objectStore('assets').get(id));
  }

  async getAssets(): Promise<Asset[]> {
    return req(this.db.transaction('assets').objectStore('assets').getAll());
  }

  async saveSettings(patch: Partial<Settings>) {
    const next = { ...this.state.settings, ...patch };
    await this.write(['settings'], (tx) => tx.objectStore('settings').put(next, 'settings'));
  }

  // ---------- drafts / scanning queue ----------

  /** Stores the file bytes and a pending draft in one transaction. */
  async addDraft(file: File, source: Draft['source']): Promise<Draft> {
    const asset = await makeAsset(file, 'original', file.type);
    const seq = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const draft: Draft = {
      id: newId(), photoId: newId(), seq, originalAssetId: asset.id,
      fileName: file.name || 'photo', fileType: file.type, source, stage: 'pending', createdAt: Date.now(),
    };
    await this.write(['assets', 'drafts'], (tx) => {
      tx.objectStore('assets').put(asset);
      tx.objectStore('drafts').put(draft);
    });
    return draft;
  }

  async updateDraft(d: Draft) {
    await this.write(['drafts'], (tx) => tx.objectStore('drafts').put(d));
  }

  async removeDraft(d: Draft) {
    await this.write(['drafts', 'assets'], (tx) => {
      tx.objectStore('drafts').delete(d.id);
      tx.objectStore('assets').delete(d.originalAssetId);
    });
  }

  /** The save boundary: photo, its assets, its people and the draft removal commit together. */
  async commitDraft(d: Draft, photo: Photo, master: Asset, thumb: Asset, personIds: string[]) {
    await this.write(['drafts', 'assets', 'photos', 'photoPersons'], (tx) => {
      tx.objectStore('assets').put(master);
      tx.objectStore('assets').put(thumb);
      tx.objectStore('photos').put(photo);
      for (const personId of new Set(personIds)) tx.objectStore('photoPersons').put({ photoId: photo.id, personId });
      tx.objectStore('drafts').delete(d.id);
    });
  }

  // ---------- photos ----------

  async updatePhoto(p: Photo) {
    p = { ...p, updatedAt: Date.now() };
    await this.write(['photos'], (tx) => tx.objectStore('photos').put(p));
  }

  async replaceRender(p: Photo, master: Asset, thumb: Asset) {
    const old = [p.masterAssetId, p.thumbAssetId];
    const next = { ...p, masterAssetId: master.id, thumbAssetId: thumb.id, updatedAt: Date.now() };
    await this.write(['photos', 'assets'], (tx) => {
      const s = tx.objectStore('assets');
      s.put(master);
      s.put(thumb);
      for (const id of old) s.delete(id);
      tx.objectStore('photos').put(next);
    });
  }

  async setPhotoPeople(photoId: string, personIds: string[]) {
    const cur = this.state.photoPersons.filter((x) => x.photoId === photoId).map((x) => x.personId);
    const want = new Set(personIds);
    await this.write(['photoPersons'], (tx) => {
      const s = tx.objectStore('photoPersons');
      for (const id of cur) if (!want.has(id)) s.delete([photoId, id]);
      for (const id of want) s.put({ photoId, personId: id });
    });
  }

  async trashPhoto(p: Photo) { await this.updatePhoto({ ...p, trashedAt: Date.now() }); }
  async restorePhoto(p: Photo) { const { trashedAt: _t, ...rest } = p; await this.updatePhoto(rest as Photo); }

  async purgePhoto(p: Photo) {
    const tags = this.state.photoPersons.filter((x) => x.photoId === p.id);
    await this.write(['photos', 'assets', 'photoPersons'], (tx) => {
      tx.objectStore('photos').delete(p.id);
      for (const id of [p.originalAssetId, p.masterAssetId, p.thumbAssetId]) tx.objectStore('assets').delete(id);
      for (const t of tags) tx.objectStore('photoPersons').delete([t.photoId, t.personId]);
    });
  }

  // ---------- people ----------

  async addPerson(data: Omit<Person, 'id' | 'createdAt'>): Promise<Person> {
    const p: Person = { ...data, displayName: data.displayName.trim(), id: newId(), createdAt: Date.now() };
    if (!p.displayName) throw new Error('请填写显示名或称呼。');
    await this.write(['persons'], (tx) => tx.objectStore('persons').put(p));
    return p;
  }

  async updatePerson(p: Person) {
    if (!p.displayName.trim()) throw new Error('请填写显示名或称呼。');
    await this.write(['persons'], (tx) => tx.objectStore('persons').put({ ...p, displayName: p.displayName.trim() }));
  }

  /** Removes the person and unlinks relations and photo tags. Photos are kept. */
  async deletePerson(id: string) {
    const rels = this.state.rels.filter((r) => r.a === id || r.b === id);
    const tags = this.state.photoPersons.filter((x) => x.personId === id);
    const settings = { ...this.state.settings };
    if (settings.meId === id) delete settings.meId;
    await this.write(['persons', 'relationships', 'photoPersons', 'settings'], (tx) => {
      tx.objectStore('persons').delete(id);
      for (const r of rels) tx.objectStore('relationships').delete(r.id);
      for (const t of tags) tx.objectStore('photoPersons').delete([t.photoId, t.personId]);
      tx.objectStore('settings').put(settings, 'settings');
    });
  }

  graph() { return new Graph(this.state.persons, this.state.rels); }

  async addRel(type: RelType, a: string, b: string) {
    const err = validateRel(this.graph(), this.state.rels, type, a, b);
    if (err) throw new Error(REL_ERROR_TEXT[err]);
    const r = makeRel(type, a, b);
    await this.write(['relationships'], (tx) => tx.objectStore('relationships').add(r));
  }

  async removeRel(id: string) {
    await this.write(['relationships'], (tx) => tx.objectStore('relationships').delete(id));
  }

  // ---------- derived ----------

  peopleOf(photoId: string): string[] {
    return this.state.photoPersons.filter((x) => x.photoId === photoId).map((x) => x.personId);
  }
}
