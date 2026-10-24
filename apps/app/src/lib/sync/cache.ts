// The device copy (TV-D11a): one IndexedDB record per person and workspace.
//
// A thin wrapper over IndexedDB rather than Dexie (decisions/tasks.md
// "TV-D11a"): the store reads and writes one record per workspace whole, so
// none of Dexie's indexes or queries are used, and the app ships one less
// runtime. If TV-D11b needs per-row reads, the `SyncCache` seam is where a
// richer store goes.
//
// Records are keyed `<person>:<workspace>`, so one browser never shows a
// person another's copy. On sign-out, and when someone else signs in on the
// device, every copy but theirs is cut down to what still waits to sync (no
// rows), kept under its person's key until they sign in here again; account
// deletion wipes everything. A copy holds only the rows the views read: never a token, key
// or session, comments without their text, files as marks only (no name, path
// or size), no time entries or agent sessions.
// Where IndexedDB is missing (tests, a locked-down browser) there is no copy:
// the store still works, it just opens from the server.

import { idbOpener, idbRequest } from "./kernel/idb";
import { isOwnedBy, type OwnedCopies, ownerKey } from "./kernel/registry";
import type { SyncTableName } from "./types";

/** Bumped when the persisted shape changes: an older copy's rows are dropped (its waiting captures are kept).
 *  3: projects carry their colour and archive stamp (TV-U6).
 *  4: reminders carry their suspension (TV-D12).
 *  5: agent sessions join the copy (TV-D16).
 *  6: file marks join the copy (AT-3; id, task, stamps only). */
export const CACHE_VERSION = 6;

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
  /** The record as stored, any version (the store keeps an older copy's outbox only). */
  read(key: string): Promise<CachedWorkspace | null>;
  write(key: string, value: CachedWorkspace): Promise<void>;
  /**
   * Read and write one record in one step (one IndexedDB transaction): `next`
   * gets what's stored and returns what to store (null: delete the record).
   * Two tabs writing at once can't drop each other's waiting captures.
   * Resolves to what was stored; rejects when the record couldn't be read or
   * written (never "nothing stored": a caller that cuts a copy down would
   * delete what waits in it).
   */
  update(
    key: string,
    next: (stored: CachedWorkspace | null) => CachedWorkspace | null,
  ): Promise<CachedWorkspace | null>;
  /** Every record's key. */
  keys(): Promise<string[]>;
  /** Wipe every copy (account deletion). */
  clear(): Promise<void>;
  /** Wipe the copies whose key matches (another person's, a workspace you left). */
  deleteWhere(match: (key: string) => boolean): Promise<void>;
}

/**
 * A copy with a late write in it (MOD-569): in front of the first entry
 * `sameTask` picks (newer, for its task), else at the end; once. No copy: a
 * cut-down one (an older version stamp, so the next store takes only the
 * outbox).
 */
export function withEntryBefore(
  stored: CachedWorkspace | null,
  entry: { id: string },
  sameTask: (stored: unknown) => boolean,
): CachedWorkspace {
  const outbox: unknown[] = Array.isArray(stored?.outbox) ? [...stored.outbox] : [];
  if (!outbox.some((e) => (e as { id?: unknown } | null)?.id === entry.id)) {
    const i = outbox.findIndex(sameTask);
    if (i < 0) outbox.push(entry);
    else outbox.splice(i, 0, entry);
  }
  return stored
    ? { ...stored, outbox }
    : { v: 0, savedAt: Date.now(), tables: {}, restLoaded: false, outbox };
}

/** The record key: `<person>:<workspace>` (the kernel's owner key). */
export const cacheKey = ownerKey;

/** Whether a record key belongs to this person. */
export const isKeyOf = isOwnedBy;

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
    async update(key, next) {
      const stored = records.get(key) ?? null;
      const before = stored ? structuredCloneSafe(stored) : null;
      const value = next(before);
      if (value) records.set(key, structuredCloneSafe(value));
      else records.delete(key);
      return before;
    },
    async keys() {
      return [...records.keys()];
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

/** The device copy in IndexedDB. Any failure reads as "no copy" (never fatal). */
export function idbCache(factory: IDBFactory): SyncCache {
  // A database that exists without the store (opened elsewhere without an
  // upgrade, or left half-made) is opened again one version up (kernel).
  const db = idbOpener(factory, {
    name: DB_NAME,
    stores: { [STORE]: (d) => d.createObjectStore(STORE) },
  });
  const tx = async (mode: IDBTransactionMode) =>
    (await db.open()).transaction(STORE, mode).objectStore(STORE);
  return {
    async read(key) {
      try {
        const value = (await idbRequest((await tx("readonly")).get(key))) as
          CachedWorkspace | undefined;
        return value && typeof value === "object" ? value : null;
      } catch {
        return null;
      }
    },
    async write(key, value) {
      try {
        await idbRequest((await tx("readwrite")).put(value, key));
      } catch {
        // A full or blocked disk: the copy is a convenience, the server keeps the truth.
      }
    },
    async update(key, next) {
      const store = await tx("readwrite");
      // The get and the put share one transaction: nothing lands between them.
      return await new Promise<CachedWorkspace | null>((resolve, reject) => {
        const get = store.get(key);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const stored = (get.result as CachedWorkspace | undefined) ?? null;
          try {
            const value = next(stored);
            const write = value ? store.put(value, key) : store.delete(key);
            write.onerror = () => reject(write.error);
            write.onsuccess = () => resolve(stored);
          } catch (e) {
            reject(e);
          }
        };
      });
    },
    async keys() {
      try {
        const keys = (await idbRequest((await tx("readonly")).getAllKeys())) as IDBValidKey[];
        return keys.filter((key): key is string => typeof key === "string");
      } catch {
        return [];
      }
    },
    async clear() {
      try {
        await idbRequest((await tx("readwrite")).clear());
      } catch {
        // Nothing to wipe.
      }
    },
    async deleteWhere(match) {
      try {
        const store = await tx("readwrite");
        const keys = (await idbRequest(store.getAllKeys())) as IDBValidKey[];
        await Promise.all(
          keys
            .filter((key) => typeof key !== "string" || match(key))
            .map((key) => idbRequest(store.delete(key))),
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
  update: async () => null,
  keys: async () => [],
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

/**
 * The device copies as the person lifecycle sees them. Cutting a copy down
 * to what waits keeps its outbox (plus what the stores that just stopped
 * held) and no rows; an older version stamp makes the next store that opens
 * it take the outbox and read everything else again.
 */
export function ownedCopies<E extends { id: string }>(cache: SyncCache): OwnedCopies<E> {
  return {
    keys: () => cache.keys(),
    async keepOnlyWaiting(key, inMemory, handled) {
      let kept = 0;
      await cache.update(key, (stored) => {
        const outbox: E[] = [];
        const seen = new Set<string>();
        const stack = [
          ...(Array.isArray(stored?.outbox) ? (stored.outbox as E[]) : []),
          ...inMemory,
        ];
        for (const entry of stack) {
          if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
          seen.add(entry.id);
          if (!handled.has(entry.id)) outbox.push(entry);
        }
        kept = outbox.length;
        // Nothing waits: the record goes in this same step, so a late write
        // handed to it meanwhile (MOD-569) can't be deleted after.
        if (kept === 0) return null;
        return { v: 0, savedAt: Date.now(), tables: {}, restLoaded: false, outbox };
      });
      return kept === 0 ? null : kept;
    },
    deleteWhere: (match) => cache.deleteWhere(match),
    clear: () => cache.clear(),
  };
}
