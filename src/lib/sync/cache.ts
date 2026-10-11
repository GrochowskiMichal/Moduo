// The device copy (TV-D11a): one IndexedDB record per person and workspace.
//
// A thin wrapper over IndexedDB rather than Dexie (decisions/tasks.md
// "TV-D11a"): the store reads and writes one record per workspace whole, so
// none of Dexie's indexes or queries are used, and the app ships one less
// runtime. If TV-D11b needs per-row reads, the `SyncCache` seam is where a
// richer store goes.
//
// Records are keyed `<person>:<workspace>`, so one browser never shows a
// person another's copy; every copy is wiped on sign-out (account deletion
// signs out too), and when someone else signs in on the device every copy but
// theirs goes. A copy holds only the rows the views read: never a token, key
// or session, comments without their text, no time entries or agent sessions.
// Where IndexedDB is missing (tests, a locked-down browser) there is no copy:
// the store still works, it just opens from the server.

import type { SyncTableName } from "./types";

/** Bumped when the persisted shape changes: an older copy is ignored. */
export const CACHE_VERSION = 2;

/** One table's rows and its delta cursor. */
export type CachedTable = { rows: unknown[]; cursor: string | null };

/** What the store writes for one workspace. */
export type CachedWorkspace = {
  v: number;
  savedAt: number;
  tables: Partial<Record<SyncTableName, CachedTable>>;
  /** Done, Won't do and Backlog tasks have been read (the first load's 2nd part). */
  restLoaded: boolean;
  /** When everything was last read whole (a delta never re-reads an unchanged row). */
  fullReadAt?: number;
  /** Captures and check-offs waiting to be sent (the offline queue). */
  outbox: unknown[];
};

export interface SyncCache {
  read(key: string): Promise<CachedWorkspace | null>;
  write(key: string, value: CachedWorkspace): Promise<void>;
  /** Wipe every copy (sign-out). */
  clear(): Promise<void>;
  /** Wipe the copies whose key matches (another person's, a workspace you left). */
  deleteWhere(match: (key: string) => boolean): Promise<void>;
}

export function cacheKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

/** Whether a record key belongs to this person. */
export function isKeyOf(key: string, userId: string): boolean {
  return key.startsWith(`${userId}:`);
}

/** A copy that lives as long as the page (tests; no IndexedDB). */
export function memoryCache(): SyncCache & { records: Map<string, CachedWorkspace> } {
  const records = new Map<string, CachedWorkspace>();
  return {
    records,
    async read(key) {
      const hit = records.get(key);
      return hit ? structuredCloneSafe(hit) : null;
    },
    async write(key, value) {
      records.set(key, structuredCloneSafe(value));
    },
    async clear() {
      records.clear();
    },
    async deleteWhere(match) {
      for (const key of [...records.keys()]) if (match(key)) records.delete(key);
    },
  };
}

function structuredCloneSafe<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

const DB_NAME = "moduo-sync";
const STORE = "workspaces";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The device copy in IndexedDB. Any failure reads as "no copy" (never fatal). */
export function idbCache(factory: IDBFactory): SyncCache {
  let db: Promise<IDBDatabase> | null = null;
  /**
   * Open the database with its store. A database that exists without the
   * store (opened elsewhere without an upgrade, or left half-made) is opened
   * again one version up, which creates it: otherwise every write would fail
   * quietly for good.
   */
  const openAt = (version?: number): Promise<IDBDatabase> =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request =
        version === undefined ? factory.open(DB_NAME) : factory.open(DB_NAME, version);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => {
        const opened = request.result;
        if (opened.objectStoreNames.contains(STORE)) {
          // Another tab upgrading must not wait on this one; the next write reopens.
          opened.onversionchange = () => {
            opened.close();
            db = null;
          };
          resolve(opened);
          return;
        }
        const next = opened.version + 1;
        opened.close();
        openAt(next).then(resolve, reject);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("The device copy is blocked by another tab."));
    });
  const open = (): Promise<IDBDatabase> => {
    db ??= openAt().catch((e) => {
      db = null;
      throw e;
    });
    return db;
  };
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    async read(key) {
      try {
        const value = (await requestToPromise((await tx("readonly")).get(key))) as
          | CachedWorkspace
          | undefined;
        return value && value.v === CACHE_VERSION ? value : null;
      } catch {
        return null;
      }
    },
    async write(key, value) {
      try {
        await requestToPromise((await tx("readwrite")).put(value, key));
      } catch {
        // A full or blocked disk: the copy is a convenience, the server keeps the truth.
      }
    },
    async clear() {
      try {
        await requestToPromise((await tx("readwrite")).clear());
      } catch {
        // Nothing to wipe.
      }
    },
    async deleteWhere(match) {
      try {
        const store = await tx("readwrite");
        const keys = (await requestToPromise(store.getAllKeys())) as IDBValidKey[];
        await Promise.all(
          keys
            .filter((key) => typeof key !== "string" || match(key))
            .map((key) => requestToPromise(store.delete(key))),
        );
      } catch {
        // Nothing to wipe.
      }
    },
  };
}

/** No device copy at all: every open reads the server (tests, no IndexedDB). */
export const noCache: SyncCache = {
  read: async () => null,
  write: async () => {},
  clear: async () => {},
  deleteWhere: async () => {},
};

let shared: SyncCache | null = null;

/** The app's device copy: IndexedDB where there is one, else none. */
export function deviceCache(): SyncCache {
  if (!shared) {
    const factory = typeof indexedDB === "undefined" ? null : indexedDB;
    shared = factory ? idbCache(factory) : noCache;
  }
  return shared;
}
