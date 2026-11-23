/** Minimal promise helpers around IndexedDB. */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

export function openDb(name: string, version: number, upgrade: (db: IDBDatabase, old: number) => void): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('数据库被其他标签页占用，请关闭其他「家影」窗口后重试。'));
  });
}

export function deleteDb(name: string): Promise<void> {
  return new Promise((res, rej) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
    r.onblocked = () => res();
  });
}

export function isQuotaError(e: unknown): boolean {
  const n = (e as { name?: string })?.name;
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED';
}
