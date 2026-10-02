/**
 * Thin promise wrapper over IndexedDB for the Notes v2 sync layer (NO-2).
 *
 * The Y.Doc content itself is persisted by y-indexeddb (one database per
 * note); THIS database holds everything around it:
 *   - `metaCache`   — the last-seen notes bundle per workspace (instant paint
 *                     + desktop offline tree).
 *   - `docOutbox`   — queued CRDT updates awaiting push (survive reloads).
 *   - `noteState`   — per-note sync cursor + client_seq counter + compaction
 *                     bookkeeping.
 *   - `metaOutbox`  — queued intent ops (create/rename/…) made offline.
 *
 * Everything fails SOFT (null / no-op) when IndexedDB is unavailable
 * (tests, SSR) — the engine then behaves like a cache-less client.
 */

const DB_NAME = "moduo-notes-v2";
const DB_VERSION = 1;

export type NoteSyncState = {
  noteId: string;
  /** Highest note_updates.id this client has PULLED and applied. */
  lastPulledUpdateId: number;
  /** Next client_seq to assign to a locally-queued update. */
  nextClientSeq: number;
  /** Updates seen since the last snapshot compaction (push+pull). */
  updatesSinceCompact: number;
};

export type DocOutboxEntry = {
  key?: number; // IDB auto-increment key (present on read)
  workspaceId: string;
  noteId: string;
  clientSeq: number;
  updateB64: string;
  queuedAt: number;
};

export type MetaOutboxEntry = {
  key?: number;
  workspaceId: string;
  kind:
    | "create"
    | "rename"
    | "move"
    | "setMeta"
    | "duplicate"
    | "archive"
    | "unarchive"
    | "trash"
    | "restore";
  args: Record<string, unknown>;
  queuedAt: number;
};

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Total queued (unsynced) entries across BOTH notes outboxes, all workspaces —
 * the Advanced → "reset local cache" data-loss guard reads this before wiping
 * the notes DBs (DF-19g). Fails soft to 0 when IndexedDB is unavailable.
 */
export async function countPendingOutbox(): Promise<number> {
  const docs = await withStore("docOutbox", "readonly", (s) => req(s.count()), 0);
  const metas = await withStore("metaOutbox", "readonly", (s) => req(s.count()), 0);
  return docs + metas;
}

/**
 * Close the cached notes DB connection and drop the singleton so a subsequent
 * `indexedDB.deleteDatabase("moduo-notes-v2")` isn't blocked by an open handle
 * (the reset-cache flow calls this right before deleting). The next
 * `openNotesDb()` transparently re-opens.
 */
export async function closeNotesDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

export function openNotesDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("metaCache")) {
        db.createObjectStore("metaCache"); // key = workspaceId
      }
      if (!db.objectStoreNames.contains("docOutbox")) {
        const store = db.createObjectStore("docOutbox", { autoIncrement: true });
        store.createIndex("byNote", "noteId");
      }
      if (!db.objectStoreNames.contains("noteState")) {
        db.createObjectStore("noteState", { keyPath: "noteId" });
      }
      if (!db.objectStoreNames.contains("metaOutbox")) {
        const store = db.createObjectStore("metaOutbox", { autoIncrement: true });
        store.createIndex("byWorkspace", "workspaceId");
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => resolve(null);
    open.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
  fallback: T,
): Promise<T> {
  const db = await openNotesDb();
  if (!db) return fallback;
  try {
    const tx = db.transaction(name, mode);
    const out = await fn(tx.objectStore(name));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    return out;
  } catch {
    return fallback;
  }
}

// ── metaCache ────────────────────────────────────────────────────────────────

export function readMetaCache(
  workspaceId: string,
): Promise<{ notes: unknown[]; savedAt: number } | null> {
  return withStore(
    "metaCache",
    "readonly",
    async (s) => {
      const v = await req(s.get(workspaceId));
      return (v as any) ?? null;
    },
    null,
  );
}

export function writeMetaCache(workspaceId: string, notes: unknown[]): Promise<void> {
  return withStore(
    "metaCache",
    "readwrite",
    async (s) => {
      await req(s.put({ notes, savedAt: Date.now() }, workspaceId));
    },
    undefined,
  );
}

// ── noteState ────────────────────────────────────────────────────────────────

export function readNoteState(noteId: string): Promise<NoteSyncState | null> {
  return withStore(
    "noteState",
    "readonly",
    async (s) => {
      const v = await req(s.get(noteId));
      return (v as NoteSyncState) ?? null;
    },
    null,
  );
}

export function writeNoteState(state: NoteSyncState): Promise<void> {
  return withStore(
    "noteState",
    "readwrite",
    async (s) => {
      await req(s.put(state));
    },
    undefined,
  );
}

// ── docOutbox ────────────────────────────────────────────────────────────────

/** Returns false when the entry could NOT be persisted (IndexedDB missing or
 * failing) — the caller must fall back to an in-memory queue, never assume
 * durability. */
export function enqueueDocUpdate(entry: DocOutboxEntry): Promise<boolean> {
  return withStore(
    "docOutbox",
    "readwrite",
    async (s) => {
      await req(s.add(entry));
      return true;
    },
    false,
  );
}

export function readDocOutbox(noteId: string): Promise<DocOutboxEntry[]> {
  return withStore(
    "docOutbox",
    "readonly",
    async (s) => {
      const idx = s.index("byNote");
      const out: DocOutboxEntry[] = [];
      await new Promise<void>((resolve, reject) => {
        const cur = idx.openCursor(IDBKeyRange.only(noteId));
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) {
            resolve();
            return;
          }
          out.push({ ...(c.value as DocOutboxEntry), key: c.primaryKey as number });
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
      return out;
    },
    [],
  );
}

export function deleteDocOutboxEntries(keys: number[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return withStore(
    "docOutbox",
    "readwrite",
    async (s) => {
      for (const k of keys) await req(s.delete(k));
    },
    undefined,
  );
}

/** Note ids that still have queued updates (wake-up flush after a reload). */
export function listDocOutboxNoteIds(workspaceId: string): Promise<string[]> {
  return withStore(
    "docOutbox",
    "readonly",
    async (s) => {
      const all = (await req(s.getAll())) as DocOutboxEntry[];
      return [...new Set(all.filter((e) => e.workspaceId === workspaceId).map((e) => e.noteId))];
    },
    [],
  );
}

// ── metaOutbox ───────────────────────────────────────────────────────────────

export function enqueueMetaOp(entry: MetaOutboxEntry): Promise<void> {
  return withStore(
    "metaOutbox",
    "readwrite",
    async (s) => {
      await req(s.add(entry));
    },
    undefined,
  );
}

export function readMetaOutbox(workspaceId: string): Promise<MetaOutboxEntry[]> {
  return withStore(
    "metaOutbox",
    "readonly",
    async (s) => {
      const idx = s.index("byWorkspace");
      const out: MetaOutboxEntry[] = [];
      await new Promise<void>((resolve, reject) => {
        const cur = idx.openCursor(IDBKeyRange.only(workspaceId));
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) {
            resolve();
            return;
          }
          out.push({ ...(c.value as MetaOutboxEntry), key: c.primaryKey as number });
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
      return out;
    },
    [],
  );
}

export function deleteMetaOutboxEntries(keys: number[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return withStore(
    "metaOutbox",
    "readwrite",
    async (s) => {
      for (const k of keys) await req(s.delete(k));
    },
    undefined,
  );
}
