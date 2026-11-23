import { deleteDb, openDb, req, txDone } from './idb';
import { newId } from '../util/id';

export const STORES = ['photos', 'persons', 'relationships', 'photoPersons', 'assets', 'drafts', 'settings'] as const;
export type StoreName = (typeof STORES)[number];

const META_DB = 'jiaying-meta';
const ARCHIVE_PREFIX = 'jiaying-archive-';
const SCHEMA = 1;

export function archiveDbName(id: string) { return ARCHIVE_PREFIX + id; }

function upgradeArchive(db: IDBDatabase) {
  if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('persons')) db.createObjectStore('persons', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('relationships')) {
    const s = db.createObjectStore('relationships', { keyPath: 'id' });
    s.createIndex('a', 'a');
    s.createIndex('b', 'b');
  }
  if (!db.objectStoreNames.contains('photoPersons')) {
    const s = db.createObjectStore('photoPersons', { keyPath: ['photoId', 'personId'] });
    s.createIndex('photoId', 'photoId');
    s.createIndex('personId', 'personId');
  }
  if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
}

export function openArchiveDb(id: string): Promise<IDBDatabase> {
  return openDb(archiveDbName(id), SCHEMA, upgradeArchive);
}

function openMeta(): Promise<IDBDatabase> {
  return openDb(META_DB, 1, (db) => {
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
  });
}

async function metaGet<T>(key: string): Promise<T | undefined> {
  const db = await openMeta();
  try { return await req(db.transaction('meta').objectStore('meta').get(key)); } finally { db.close(); }
}

async function metaPut(key: string, value: unknown): Promise<void> {
  const db = await openMeta();
  try {
    const tx = db.transaction('meta', 'readwrite');
    if (value === undefined) tx.objectStore('meta').delete(key);
    else tx.objectStore('meta').put(value, key);
    await txDone(tx);
  } finally { db.close(); }
}

/** Opens (creating if needed) the current archive. Cleans any restore staging left by a crash. */
export async function openCurrentArchive(): Promise<{ id: string; db: IDBDatabase }> {
  const staging = await metaGet<string>('staging');
  if (staging) {
    const cur = await metaGet<string>('current');
    if (staging !== cur) await deleteDb(archiveDbName(staging));
    await metaPut('staging', undefined);
  }
  let id = await metaGet<string>('current');
  if (!id) {
    id = newId();
    await metaPut('current', id);
  }
  return { id, db: await openArchiveDb(id) };
}

export async function beginStaging(): Promise<{ id: string; db: IDBDatabase }> {
  const id = newId();
  await metaPut('staging', id);
  return { id, db: await openArchiveDb(id) };
}

export async function abortStaging(id: string, db?: IDBDatabase) {
  db?.close();
  await deleteDb(archiveDbName(id));
  await metaPut('staging', undefined);
}

/** Atomic switch: a single write to the meta store makes the staged archive current. */
export async function commitStaging(newId_: string, oldId: string) {
  const db = await openMeta();
  try {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(newId_, 'current');
    tx.objectStore('meta').delete('staging');
    await txDone(tx);
  } finally { db.close(); }
  try { await deleteDb(archiveDbName(oldId)); } catch { /* old data is unreachable anyway */ }
}
