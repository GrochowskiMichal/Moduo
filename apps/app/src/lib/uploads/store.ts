// IndexedDB `moduo-uploads`: pending uploads with their bytes, so a file waits
// through a reload or an app restart (decision 8). One object store keyed by
// the item id. Fails soft (an in-memory session) where IndexedDB is missing.

import type { UploadItem, UploadStore } from "./queue";

export const UPLOADS_DB_NAME = "moduo-uploads";
const DB_VERSION = 1;
const STORE = "items";

/** "none": this device has no IndexedDB; "error": it has one that failed to open. */
type OpenResult = { kind: "ok"; db: IDBDatabase } | { kind: "none" } | { kind: "error" };

let dbPromise: Promise<OpenResult> | null = null;

function openDbResult(): Promise<OpenResult> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<OpenResult>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve({ kind: "none" });
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
      resolve({ kind: "ok", db });
    };
    // A failed open says nothing about what the database holds (645-3): it is an
    // error, never "empty", and it isn't cached, so the next call tries again.
    open.onerror = () => resolve({ kind: "error" });
    open.onblocked = () => resolve({ kind: "error" });
  });
  dbPromise = opening;
  void opening.then((r) => {
    if (r.kind === "error" && dbPromise === opening) dbPromise = null;
  });
  return opening;
}

async function openDb(): Promise<IDBDatabase | null> {
  const opened = await openDbResult();
  return opened.kind === "ok" ? opened.db : null;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** A write counts once its transaction commits, not when its request succeeds
 *  (a quota error can still abort the transaction after that). */
function committed(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

async function writeTx(fn: (s: IDBObjectStore) => void): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = committed(tx);
    fn(tx.objectStore(STORE));
    return await done;
  } catch {
    return false;
  }
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
  // Holds the session's items when IndexedDB is unavailable or a write failed,
  // so `get` never answers "gone" for a file that simply wasn't stored.
  const memory = new Map<string, UploadItem>();
  return {
    async all() {
      const db = await openDb();
      if (!db) return [...memory.values()];
      return withStore("readonly", (s) => req(s.getAll() as IDBRequest<UploadItem[]>), []);
    },
    async get(id) {
      const kept = memory.get(id);
      if (kept) return kept;
      const opened = await openDbResult();
      // No IndexedDB: memory is the whole store, so it's gone. A failed open: unknown.
      if (opened.kind === "none") return null;
      if (opened.kind === "error") return undefined;
      return withStore<UploadItem | null | undefined>(
        "readonly",
        (s) => req(s.get(id) as IDBRequest<UploadItem | undefined>).then((v) => v ?? null),
        undefined,
      );
    },
    async put(item) {
      const ok = await writeTx((s) => s.put(item));
      // Not stored (no IndexedDB, quota, an unstorable Blob): keep it for this
      // session at least. It won't survive a restart, and `put` says so.
      if (ok) memory.delete(item.id);
      else memory.set(item.id, item);
      return ok;
    },
    async remove(id) {
      memory.delete(id);
      await writeTx((s) => s.delete(id));
    },
  };
}

/**
 * Every upload waiting in IndexedDB, or "unknown" when the database or its
 * store can't be read (645-3): the "Reset local cache" guard must never read a
 * failed open as "nothing waiting". [] only when the device has no IndexedDB.
 */
export async function readStoredUploads(): Promise<UploadItem[] | "unknown"> {
  const opened = await openDbResult();
  if (opened.kind === "none") return [];
  if (opened.kind === "error") return "unknown";
  try {
    const s = opened.db.transaction(STORE, "readonly").objectStore(STORE);
    return await req(s.getAll() as IDBRequest<UploadItem[]>);
  } catch {
    return "unknown";
  }
}

/** Close the handle so the reset flow's deleteDatabase isn't blocked. */
export async function closeUploadsDb(): Promise<void> {
  if (!dbPromise) return;
  const opened = await dbPromise;
  if (opened.kind === "ok") opened.db.close();
  dbPromise = null;
}
