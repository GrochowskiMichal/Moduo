/**
 * Whose notes caches stay on this device (Track C4), through the sync
 * kernel's person lifecycle, as Tasks' and Chat's copies do:
 *   - Someone signs in: every other person's caches (the notes list, the
 *     per-note documents, their pull cursors) go; what they still have
 *     waiting to sync (queued edits and ops) stays under their key until they
 *     sign in here again.
 *   - A null session is not a sign-out: nothing goes.
 *   - Signed out: everyone's caches go, the outboxes stay. Account deletion
 *     takes the outboxes too.
 *   - A workspace no longer on the list takes its caches and outboxes.
 *
 * Before Track C4 the caches were keyed by workspace only, nobody's. On
 * every sign-in they go (`forgetLegacy`): the notes lists, the per-note
 * documents and the one device-wide cursor. They are caches (the next open
 * reads each note whole from the server); handing them to whoever signs in
 * first would show them a previous person's notes. What waited to sync then
 * carries no person and stays as it was: sent by whoever opens its workspace.
 *
 * A sign-out or a switch stops the engines at once (synchronously, before the
 * React tree tears down), so a disposed engine never sends a person's edits
 * under the next person's session; the caches go after.
 */

import { browserIdb } from "../../../lib/sync/kernel/idb";
import {
  type OwnedCopies,
  personLifecycle,
  StoreRegistry,
} from "../../../lib/sync/kernel/registry";
import type { NotesSyncEngineV2 } from "./engine-v2";
import {
  DOC_DB_PREFIX,
  docDbName,
  type DocOutboxEntry,
  entryOwner,
  type MetaOutboxEntry,
  type NoteStateRow,
  parseDocDbName,
  readAll,
  req,
  setNotesSignedIn,
  stripLegacy,
  withStore,
} from "./idb";

/** The running engines (each `useNotesModule` makes its own; they track themselves). */
export const notesEngines = new StoreRegistry<NotesSyncEngineV2>();

/** Every per-note database name the browser lists (none where it can't list them). */
async function docDatabases(): Promise<string[]> {
  const factory = browserIdb();
  if (!factory || typeof factory.databases !== "function") return [];
  try {
    const all = await factory.databases();
    return all.map((d) => d.name ?? "").filter((n) => n.startsWith(DOC_DB_PREFIX));
  } catch {
    return [];
  }
}

function deleteDatabase(name: string): Promise<void> {
  const factory = browserIdb();
  if (!factory) return Promise.resolve();
  return new Promise((resolve) => {
    const r = factory.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

/** Owners with anything on the device: the list, documents, cursors, outboxes. */
async function owners(): Promise<string[]> {
  const found = new Set<string>();
  const add = (o: string | null) => {
    if (o?.includes(":")) found.add(o);
  };
  await withStore(
    ["metaCache", "docOutbox", "noteState", "metaOutbox"],
    "readonly",
    async (_s, tx) => {
      for (const k of await req(tx.objectStore("metaCache").getAllKeys())) {
        if (typeof k === "string") add(k);
      }
      for (const e of (await req(tx.objectStore("docOutbox").getAll())) as DocOutboxEntry[]) {
        add(entryOwner(e));
      }
      for (const e of (await req(tx.objectStore("metaOutbox").getAll())) as MetaOutboxEntry[]) {
        add(entryOwner(e));
      }
      for (const row of (await req(tx.objectStore("noteState").getAll())) as NoteStateRow[]) {
        for (const o of Object.keys(row.cursors ?? {})) add(o);
      }
    },
    undefined,
  );
  for (const name of await docDatabases()) {
    const parsed = parseDocDbName(name);
    if (parsed && "owner" in parsed) add(parsed.owner);
  }
  return [...found];
}

/** Drop an owner's caches (list, cursors, documents); answers how many outbox entries it has. */
async function dropCaches(owner: string): Promise<number> {
  const docs = new Set<string>();
  const waiting = await withStore(
    ["metaCache", "docOutbox", "noteState", "metaOutbox"],
    "readwrite",
    async (_s, tx) => {
      tx.objectStore("metaCache").delete(owner);
      const state = tx.objectStore("noteState");
      for (const row of (await req(state.getAll())) as NoteStateRow[]) {
        if (!row.cursors?.[owner]) continue;
        docs.add(docDbName(owner, row.noteId));
        const { [owner]: _gone, ...rest } = row.cursors;
        state.put({ ...row, cursors: rest });
      }
      const queued = [
        ...((await req(tx.objectStore("docOutbox").getAll())) as DocOutboxEntry[]),
        ...((await req(tx.objectStore("metaOutbox").getAll())) as MetaOutboxEntry[]),
      ];
      return queued.filter((e) => entryOwner(e) === owner).length;
    },
    0,
  );
  for (const name of await docDatabases()) {
    const parsed = parseDocDbName(name);
    if (parsed && "owner" in parsed && parsed.owner === owner) docs.add(name);
  }
  for (const name of docs) await deleteDatabase(name);
  return waiting;
}

/** Drop an owner's outbox entries too. */
async function dropOutboxes(owner: string): Promise<void> {
  await withStore(
    ["docOutbox", "metaOutbox"],
    "readwrite",
    async (_s, tx) => {
      for (const name of ["docOutbox", "metaOutbox"]) {
        const store = tx.objectStore(name);
        for (const e of await readAll<DocOutboxEntry | MetaOutboxEntry>(store)) {
          if (entryOwner(e) === owner) store.delete(e.key);
        }
      }
    },
    undefined,
  );
}

const copies: OwnedCopies<never> = {
  keys: owners,
  keepOnlyWaiting: (owner) => dropCaches(owner),
  async deleteWhere(match) {
    for (const owner of await owners()) {
      if (!match(owner)) continue;
      await dropCaches(owner);
      await dropOutboxes(owner);
    }
  },
  async clear() {
    const docs = new Set<string>();
    await withStore(
      ["metaCache", "docOutbox", "noteState", "metaOutbox"],
      "readwrite",
      async (_s, tx) => {
        tx.objectStore("metaCache").clear();
        // Everyone's queued work goes, but not what predates Track C4 (nobody's).
        for (const name of ["docOutbox", "metaOutbox"]) {
          const store = tx.objectStore(name);
          for (const e of await readAll<DocOutboxEntry | MetaOutboxEntry>(store)) {
            if (e.userId) store.delete(e.key);
          }
        }
        // The seq counters stay: the device's client id outlives the account.
        const state = tx.objectStore("noteState");
        for (const row of (await req(state.getAll())) as NoteStateRow[]) {
          // Their cursors name their document caches, for a browser that can't list databases.
          for (const owner of Object.keys(row.cursors ?? {}))
            docs.add(docDbName(owner, row.noteId));
          state.put({ noteId: row.noteId, nextClientSeq: row.nextClientSeq });
        }
      },
      undefined,
    );
    for (const name of await docDatabases()) docs.add(name);
    for (const name of docs) await deleteDatabase(name);
  },
};

const people = personLifecycle({
  registry: notesEngines,
  scopeOf: (engine) => engine,
  copies: () => copies,
  // The outboxes live in IndexedDB as they're made: nothing waits in memory only.
  waiting: () => [] as never[],
});

/**
 * Forget what Notes cached before Track C4 (nobody's): the notes lists, the
 * per-note documents and the device-wide cursors. Queued work stays. Safe to
 * run on every sign-in: after the first, there is nothing left.
 */
export async function forgetLegacy(): Promise<void> {
  const legacyDocs = new Set<string>();
  for (const name of await docDatabases()) {
    const parsed = parseDocDbName(name);
    if (parsed && "legacyWorkspace" in parsed) legacyDocs.add(name);
  }
  // A browser that can't list databases (no `indexedDB.databases()`) still
  // yields their names: a legacy list is keyed by its workspace, and a note
  // with the device-wide cursor is exactly one whose document cache was
  // cached under `<workspace>:<note>`.
  for (const name of await legacyDocNames()) legacyDocs.add(name);
  for (const name of legacyDocs) await deleteDatabase(name);
  await withStore(
    ["metaCache", "noteState"],
    "readwrite",
    async (_s, tx) => {
      const lists = tx.objectStore("metaCache");
      for (const k of await req(lists.getAllKeys())) {
        if (typeof k === "string" && !k.includes(":")) lists.delete(k);
      }
      const state = tx.objectStore("noteState");
      for (const row of (await req(state.getAll())) as NoteStateRow[]) {
        if (row.lastPulledUpdateId === undefined && row.updatesSinceCompact === undefined) continue;
        state.put(stripLegacy(row));
      }
    },
    undefined,
  );
}

/** The per-note database names from before Track C4, worked out from the records that name them. */
async function legacyDocNames(): Promise<string[]> {
  return withStore(
    ["metaCache", "noteState"],
    "readonly",
    async (_s, tx) => {
      const workspaces = (await req(tx.objectStore("metaCache").getAllKeys())).filter(
        (k): k is string => typeof k === "string" && !k.includes(":"),
      );
      if (workspaces.length === 0) return [];
      const rows = (await req(tx.objectStore("noteState").getAll())) as NoteStateRow[];
      const notes = rows
        .filter((r) => r.lastPulledUpdateId !== undefined || r.updatesSinceCompact !== undefined)
        .map((r) => r.noteId);
      return workspaces.flatMap((ws) => notes.map((n) => `${DOC_DB_PREFIX}${ws}:${n}`));
    },
    [] as string[],
  );
}

/** Stop engines now (before anything else of the switch runs). */
function stopEngines(keep: (engine: NotesSyncEngineV2) => boolean): void {
  notesEngines.disposeWhere((engine) => engine, keep, false);
}

let attaching: Promise<void> = Promise.resolve();

/** One lifecycle step after another; a failed one never blocks the next. */
function chain(step: () => Promise<void>): Promise<void> {
  attaching = attaching.then(step, step).catch((e) => {
    console.warn("[notes-sync] cache cleanup failed", e);
  });
  return attaching;
}

/**
 * Who is signed in now (the auth shell calls this on every change). Someone:
 * every other person's engines stop at once, what was nobody's goes, then
 * every other person's caches go (their outboxes stay). Nobody: nothing
 * changes (a null session isn't a sign-out).
 */
export function attachNotesUser(userId: string | null): Promise<void> {
  if (userId) {
    setNotesSignedIn(userId);
    stopEngines((engine) => engine.userId === userId);
  }
  return chain(async () => {
    if (userId) await forgetLegacy();
    await people.attachUser(userId);
  });
}

/** Signed out: everyone's caches go, the outboxes stay (`keepWaiting: false`: they go too). */
export function wipeNotesCopies(opts: { keepWaiting?: boolean } = {}): Promise<void> {
  setNotesSignedIn(null);
  stopEngines(() => false);
  return chain(() => people.wipe(opts));
}

/** The person's workspace list came back: caches and outboxes of workspaces not on it go. */
export function keepNotesWorkspaces(
  userId: string,
  workspaceIds: readonly string[],
): Promise<void> {
  return chain(() => people.keepWorkspaces(userId, workspaceIds));
}
