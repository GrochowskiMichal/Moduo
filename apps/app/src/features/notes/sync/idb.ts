/**
 * Thin promise wrapper over IndexedDB for the Notes v2 sync layer (NO-2).
 *
 * The Y.Doc content itself is persisted by y-indexeddb (one database per
 * note, `docDbName`); THIS database holds everything around it:
 *   - `metaCache`   — the last-seen notes bundle per person and workspace
 *                     (instant paint + desktop offline tree).
 *   - `docOutbox`   — queued CRDT updates awaiting push (survive reloads).
 *   - `noteState`   — per-note client_seq counter, and per person and
 *                     workspace the pull cursor + compaction bookkeeping.
 *   - `metaOutbox`  — queued intent ops (create/rename/…) made offline.
 *
 * Everything is one person's (Track C4): keyed `<person>:<workspace>` (the
 * sync kernel's owner key) like Tasks' and Chat's copies, so one browser never
 * paints a person another's notes. A sign-out or another person signing in
 * cuts a person's caches down to their outboxes (`people.ts`), and from that
 * moment nothing is written or sent for them (`mayWrite`). Queued entries from
 * before Track C4 carry no person: they stay as they were, sent by whoever
 * opens their workspace (the old behaviour), and no sign-out or switch
 * removes them.
 *
 * The client_seq counter stays per note, not per person: the client id is the
 * device's (`getNotesClientId`), and the server dedupes on (client, seq), so
 * two people on one device must never reuse a seq. The pull cursor is per
 * person because it belongs to that person's document cache: a cursor
 * without its cache would skip content on the next pull.
 *
 * Everything fails SOFT (null / no-op) when IndexedDB is unavailable
 * (tests, SSR) — the engine then behaves like a cache-less client.
 */

import { browserIdb, idbOpener } from "../../../lib/sync/kernel/idb";
import { ownerKey } from "../../../lib/sync/kernel/registry";

export const NOTES_DB_NAME = "moduo-notes-v2";
/** Every per-note y-indexeddb database starts with this. */
export const DOC_DB_PREFIX = "moduo:notes-v2:doc:";

/** One note's y-indexeddb database for a person and workspace. */
export function docDbName(owner: string, noteId: string): string {
  return `${DOC_DB_PREFIX}${owner}:${noteId}`;
}

/**
 * A per-note database name, read back: a person's (`user:ws:note`) or one
 * from before Track C4 (`ws:note`, nobody's).
 */
export function parseDocDbName(
  name: string,
): { owner: string; noteId: string } | { legacyWorkspace: string; noteId: string } | null {
  if (!name.startsWith(DOC_DB_PREFIX)) return null;
  const parts = name.slice(DOC_DB_PREFIX.length).split(":");
  if (parts.length === 3 && parts.every(Boolean)) {
    return { owner: `${parts[0]}:${parts[1]}`, noteId: parts[2]! };
  }
  if (parts.length === 2 && parts.every(Boolean)) {
    return { legacyWorkspace: parts[0]!, noteId: parts[1]! };
  }
  return null;
}

/**
 * Who is signed in, as the auth shell last said (undefined: not said yet).
 * A null session doesn't change it (it isn't a sign-out); a sign-out sets null.
 */
let signedIn: string | null | undefined;

/** `undefined`: back to "not said yet" (tests). */
export function setNotesSignedIn(userId: string | null | undefined): void {
  signedIn = userId;
}

/** Whether anything may be written or sent for this person now. */
export function mayWrite(userId: string): boolean {
  return signedIn === undefined || signedIn === userId;
}

/** Whose caches an engine reads and writes. `stopped`: wiped, write nothing more. */
export type NotesOwner = { userId: string; workspaceId: string; stopped?: boolean };

export function ownerOf(owner: NotesOwner): string {
  return ownerKey(owner.userId, owner.workspaceId);
}

export type NoteSyncState = {
  noteId: string;
  /** Highest note_updates.id this client has PULLED and applied. */
  lastPulledUpdateId: number;
  /** Next client_seq to assign to a locally-queued update. */
  nextClientSeq: number;
  /** Updates seen since the last snapshot compaction (push+pull). */
  updatesSinceCompact: number;
};

/** A person's cursor into a note, with their document cache. */
export type NoteCursor = { lastPulledUpdateId: number; updatesSinceCompact: number };

/** What `noteState` stores per note. */
export type NoteStateRow = {
  noteId: string;
  nextClientSeq: number;
  /** By owner key (`<person>:<workspace>`). */
  cursors?: Record<string, NoteCursor>;
  /** Before Track C4: the device's one cursor (its document cache was nobody's). */
  lastPulledUpdateId?: number;
  updatesSinceCompact?: number;
};

export type DocOutboxEntry = {
  key?: number; // IDB auto-increment key (present on read)
  /** Whose edit it is (absent before Track C4: adopted by the next person to sign in). */
  userId?: string;
  workspaceId: string;
  noteId: string;
  clientSeq: number;
  updateB64: string;
  queuedAt: number;
};

export type MetaOutboxEntry = {
  key?: number;
  userId?: string;
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
    | "restore"
    | "file"
    | "setFavorite";
  args: Record<string, unknown>;
  queuedAt: number;
};

/** An outbox entry's owner key (null: from before Track C4, nobody's yet). */
export function entryOwner(entry: { userId?: string; workspaceId: string }): string | null {
  return entry.userId ? ownerKey(entry.userId, entry.workspaceId) : null;
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let opener: ReturnType<typeof idbOpener> | null = null;

function notesOpener() {
  const factory = browserIdb();
  if (!factory) return null;
  // A database left without one of its stores is reopened one version up (kernel).
  opener ??= idbOpener(factory, {
    name: NOTES_DB_NAME,
    stores: {
      metaCache: (db) => db.createObjectStore("metaCache"), // key = owner
      docOutbox: (db) =>
        db.createObjectStore("docOutbox", { autoIncrement: true }).createIndex("byNote", "noteId"),
      noteState: (db) => db.createObjectStore("noteState", { keyPath: "noteId" }),
      metaOutbox: (db) =>
        db
          .createObjectStore("metaOutbox", { autoIncrement: true })
          .createIndex("byWorkspace", "workspaceId"),
    },
  });
  return opener;
}

/** A count read from the device, or "unknown" when the database couldn't be read. */
export type PendingCount = number | "unknown";

/**
 * Total queued (unsynced) entries across BOTH notes outboxes, everyone's —
 * the Advanced → "reset local cache" data-loss guard reads this before wiping
 * the notes DBs (DF-19g). 0 when this device has no IndexedDB (nothing can be
 * queued here); "unknown" when the database or its stores couldn't be read,
 * so a failed open never reads as "nothing to lose".
 */
export async function countPendingOutbox(): Promise<PendingCount> {
  const opened = await openNotesDbResult();
  if (opened.kind === "none") return 0;
  if (opened.kind === "error") return "unknown";
  try {
    const tx = opened.db.transaction(["docOutbox", "metaOutbox"], "readonly");
    const [docs, metas] = await Promise.all([
      req(tx.objectStore("docOutbox").count()),
      req(tx.objectStore("metaOutbox").count()),
    ]);
    return docs + metas;
  } catch {
    return "unknown";
  }
}

/**
 * Close the cached notes DB connection so a subsequent
 * `indexedDB.deleteDatabase("moduo-notes-v2")` isn't blocked by an open handle
 * (the reset-cache flow calls this right before deleting). The next
 * `openNotesDb()` transparently re-opens.
 */
export async function closeNotesDb(): Promise<void> {
  await opener?.close();
}

type OpenResult = { kind: "ok"; db: IDBDatabase } | { kind: "none" } | { kind: "error" };

/** "none": this device has no IndexedDB; "error": it has one that failed to open. */
async function openNotesDbResult(): Promise<OpenResult> {
  const o = notesOpener();
  if (!o) return { kind: "none" };
  try {
    return { kind: "ok", db: await o.open() };
  } catch {
    return { kind: "error" };
  }
}

/** The notes DB, or null when there is none or it failed to open (callers fail soft). */
export async function openNotesDb(): Promise<IDBDatabase | null> {
  const opened = await openNotesDbResult();
  return opened.kind === "ok" ? opened.db : null;
}

export async function withStore<T>(
  name: string | string[],
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T>,
  fallback: T,
): Promise<T> {
  const db = await openNotesDb();
  if (!db) return fallback;
  try {
    const tx = db.transaction(name, mode);
    const first = Array.isArray(name) ? name[0]! : name;
    const out = await fn(tx.objectStore(first), tx);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    return out;
  } catch {
    return fallback;
  }
}

/** Every value of a store or index range, with its primary key. */
export function readAll<T>(
  source: IDBObjectStore | IDBIndex,
  range?: IDBKeyRange,
): Promise<(T & { key: number })[]> {
  return new Promise((resolve, reject) => {
    const out: (T & { key: number })[] = [];
    const cur = source.openCursor(range);
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) {
        resolve(out);
        return;
      }
      out.push({ ...(c.value as T), key: c.primaryKey as number });
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

// ── metaCache ────────────────────────────────────────────────────────────────

export function readMetaCache(
  userId: string,
  workspaceId: string,
): Promise<{ notes: unknown[]; savedAt: number } | null> {
  return withStore(
    "metaCache",
    "readonly",
    async (s) => {
      const v = await req(s.get(ownerKey(userId, workspaceId)));
      return (v as { notes: unknown[]; savedAt: number } | undefined) ?? null;
    },
    null,
  );
}

export function writeMetaCache(
  userId: string,
  workspaceId: string,
  notes: unknown[],
): Promise<void> {
  // A load that answers after the person signed out (or someone else in) writes nothing.
  if (!mayWrite(userId)) return Promise.resolve();
  return withStore(
    "metaCache",
    "readwrite",
    async (s) => {
      await req(s.put({ notes, savedAt: Date.now() }, ownerKey(userId, workspaceId)));
    },
    undefined,
  );
}

// ── noteState ────────────────────────────────────────────────────────────────

/** The engine's view of a stored row: the note's counter with this owner's cursor. */
export function stateFor(
  row: NoteStateRow | null,
  noteId: string,
  owner: string,
): NoteSyncState | null {
  if (!row) return null;
  const cursor = row.cursors?.[owner];
  return {
    noteId,
    nextClientSeq: row.nextClientSeq,
    lastPulledUpdateId: cursor?.lastPulledUpdateId ?? 0,
    updatesSinceCompact: cursor?.updatesSinceCompact ?? 0,
  };
}

/** A stored row with this owner's state written in (other owners' cursors kept). */
export function withState(
  row: NoteStateRow | null,
  state: NoteSyncState,
  owner: string,
): NoteStateRow {
  return {
    noteId: state.noteId,
    // Never backwards: another engine on this note (a tab, another person on
    // this device) may have taken seqs since; a reused seq is dropped by the
    // server's dedupe on (client, seq).
    nextClientSeq: Math.max(row?.nextClientSeq ?? 0, state.nextClientSeq),
    cursors: {
      ...stripLegacy(row)?.cursors,
      [owner]: {
        lastPulledUpdateId: state.lastPulledUpdateId,
        updatesSinceCompact: state.updatesSinceCompact,
      },
    },
  };
}

/** A row without the device-wide cursor from before Track C4 (its cache may be gone). */
export function stripLegacy(row: NoteStateRow | null): NoteStateRow | null {
  if (!row) return null;
  const { lastPulledUpdateId: _l, updatesSinceCompact: _u, ...rest } = row;
  return rest;
}

export function readNoteState(owner: NotesOwner, noteId: string): Promise<NoteSyncState | null> {
  return withStore(
    "noteState",
    "readonly",
    async (s) =>
      stateFor(((await req(s.get(noteId))) as NoteStateRow) ?? null, noteId, ownerOf(owner)),
    null,
  );
}

/** Whether an engine may still write or send for its owner. */
export function ownerLive(owner: NotesOwner): boolean {
  return !owner.stopped && mayWrite(owner.userId);
}

export function writeNoteState(owner: NotesOwner, state: NoteSyncState): Promise<void> {
  if (!ownerLive(owner)) return Promise.resolve();
  return withStore(
    "noteState",
    "readwrite",
    async (s) => {
      const row = ((await req(s.get(state.noteId))) as NoteStateRow | undefined) ?? null;
      await req(s.put(withState(row, state, ownerOf(owner))));
    },
    undefined,
  );
}

// ── docOutbox ────────────────────────────────────────────────────────────────

/** Returns false when the entry could NOT be persisted (IndexedDB missing or
 * failing) — the caller must fall back to an in-memory queue, never assume
 * durability. */
export function enqueueDocUpdate(
  owner: NotesOwner,
  entry: Omit<DocOutboxEntry, "userId" | "workspaceId">,
): Promise<boolean> {
  if (!ownerLive(owner)) return Promise.resolve(false);
  return withStore(
    "docOutbox",
    "readwrite",
    async (s) => {
      await req(s.add({ ...entry, userId: owner.userId, workspaceId: owner.workspaceId }));
      return true;
    },
    false,
  );
}

/** Queued entries an owner sends: theirs, and those from before Track C4 (nobody's) in their workspace. */
function sendsFor(owner: NotesOwner, e: { userId?: string; workspaceId: string }): boolean {
  if (e.workspaceId !== owner.workspaceId) return false;
  return !e.userId || e.userId === owner.userId;
}

/** A note's queued updates of this person (another person's on this device wait for them). */
export function readDocOutbox(owner: NotesOwner, noteId: string): Promise<DocOutboxEntry[]> {
  return withStore(
    "docOutbox",
    "readonly",
    async (s) => {
      const all = await readAll<DocOutboxEntry>(s.index("byNote"), IDBKeyRange.only(noteId));
      return all.filter((e) => sendsFor(owner, e));
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

/** Note ids that still have this person's queued updates (wake-up flush after a reload). */
export function listDocOutboxNoteIds(owner: NotesOwner): Promise<string[]> {
  return withStore(
    "docOutbox",
    "readonly",
    async (s) => {
      const all = (await req(s.getAll())) as DocOutboxEntry[];
      return [...new Set(all.filter((e) => sendsFor(owner, e)).map((e) => e.noteId))];
    },
    [],
  );
}

// ── metaOutbox ───────────────────────────────────────────────────────────────

export function enqueueMetaOp(
  owner: NotesOwner,
  entry: Omit<MetaOutboxEntry, "userId" | "workspaceId">,
): Promise<void> {
  if (!ownerLive(owner)) return Promise.resolve();
  return withStore(
    "metaOutbox",
    "readwrite",
    async (s) => {
      await req(s.add({ ...entry, userId: owner.userId, workspaceId: owner.workspaceId }));
    },
    undefined,
  );
}

export function readMetaOutbox(owner: NotesOwner): Promise<MetaOutboxEntry[]> {
  return withStore(
    "metaOutbox",
    "readonly",
    async (s) => {
      const all = await readAll<MetaOutboxEntry>(
        s.index("byWorkspace"),
        IDBKeyRange.only(owner.workspaceId),
      );
      return all.filter((e) => sendsFor(owner, e));
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
