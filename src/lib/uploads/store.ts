// IndexedDB `moduo-uploads`: pending uploads with their bytes, so a file waits
// through a reload or an app restart (decision 8). One object store keyed by
// the item id. Fails soft (an in-memory session) where IndexedDB is missing.

import type { UploadItem, UploadStore } from "./queue";

export const UPLOADS_DB_NAME = "moduo-uploads";
const DB_VERSION = 1;
const STORE = "items";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const open = indexedDB.open(UPLOADS_DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    open.onsuccess = () => {
      const db = open.result;
      // Another tab upgrading, or the reset-cache flow deleting it.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    open.onerror = () => resolve(null);
    open.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => Promise<T>,
  fallback: T,
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  try {
    return await fn(db.transaction(STORE, mode).objectStore(STORE));
  } catch {
    return fallback;
  }
}

export function idbUploadStore(): UploadStore {
  // Holds the session's items when IndexedDB is unavailable.
  const memory = new Map<string, UploadItem>();
  return {
    async all() {
      const db = await openDb();
      if (!db) return [...memory.values()];
      return withStore("readonly", (s) => req(s.getAll() as IDBRequest<UploadItem[]>), []);
    },
    async put(item) {
      const db = await openDb();
      if (!db) {
        memory.set(item.id, item);
        return;
      }
      await withStore("readwrite", (s) => req(s.put(item)).then(() => undefined), undefined);
    },
    async remove(id) {
      memory.delete(id);
      await withStore("readwrite", (s) => req(s.delete(id)).then(() => undefined), undefined);
    },
  };
}

/** Files waiting to upload on this device, every account (the reset guard). */
export async function countStoredUploads(): Promise<number> {
  return withStore("readonly", (s) => req(s.count()), 0);
}

/** Close the handle so the reset flow's deleteDatabase isn't blocked. */
export async function closeUploadsDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}
