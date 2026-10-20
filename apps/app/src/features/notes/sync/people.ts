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
 * Before Track C4 the caches were keyed by workspace only, nobody's. The
 * first person to sign in after the update adopts them (`adoptLegacy`): they
 * were the one reading them already, and from then on every person's are
 * their own and wiped on a switch. A document cache moves under its new name
 * (copied through Yjs) together with its cursor; a cursor whose document
 * cache can't be found is dropped (the next pull reads the note whole).
 */

import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

import { browserIdb } from "../../../lib/sync/kernel/idb";
import {
  type OwnedCopies,
  ownerKey,
  personLifecycle,
  StoreRegistry,
} from "../../../lib/sync/kernel/registry";
import type { NotesSyncEngineV2 } from "./engine-v2";
import {
  DOC_DB_PREFIX,
  type DocOutboxEntry,
  docDbName,
  entryOwner,
  type MetaOutboxEntry,
  type NoteStateRow,
  parseDocDbName,
  readAll,
  req,
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
    await withStore(
      ["metaCache", "docOutbox", "noteState", "metaOutbox"],
      "readwrite",
      async (_s, tx) => {
        for (const name of ["metaCache", "docOutbox", "metaOutbox"]) tx.objectStore(name).clear();
        // The seq counters stay: the device's client id outlives the account.
        const state = tx.objectStore("noteState");
        for (const row of (await req(state.getAll())) as NoteStateRow[]) {
          state.put({ noteId: row.noteId, nextClientSeq: row.nextClientSeq });
        }
      },
      undefined,
    );
    for (const name of await docDatabases()) await deleteDatabase(name);
  },
};

const people = personLifecycle({
  registry: notesEngines,
  scopeOf: (engine) => engine,
  copies: () => copies,
  // The outboxes live in IndexedDB as they're made: nothing waits in memory only.
  waiting: () => [] as never[],
});

/** Copy one y-indexeddb document to a new database name (through Yjs). */
async function copyDocDb(from: string, to: string): Promise<boolean> {
  const doc = new Y.Doc();
  try {
    const source = new IndexeddbPersistence(from, doc);
    await source.whenSynced;
    // The target stores the whole state on its first sync.
    const target = new IndexeddbPersistence(to, doc);
    await target.whenSynced;
    await Promise.all([source.destroy(), target.destroy()]);
    return true;
  } catch {
    return false;
  } finally {
    doc.destroy();
  }
}

/**
 * Make what Notes kept before Track C4 this person's: the notes lists, the
 * queued edits and ops, and each document cache with its cursor. Safe to run
 * on every sign-in: once adopted, nothing is nobody's.
 */
export async function adoptLegacy(userId: string): Promise<void> {
  const moved = new Map<string, string>(); // noteId → owner, for documents moved with their cursor
  for (const name of await docDatabases()) {
    const parsed = parseDocDbName(name);
    if (!parsed || !("legacyWorkspace" in parsed)) continue;
    const owner = ownerKey(userId, parsed.legacyWorkspace);
    if (await copyDocDb(name, docDbName(owner, parsed.noteId))) {
      moved.set(parsed.noteId, owner);
      await deleteDatabase(name);
    }
  }
  await withStore(
    ["metaCache", "docOutbox", "noteState", "metaOutbox"],
    "readwrite",
    async (_s, tx) => {
      const lists = tx.objectStore("metaCache");
      const keys = (await req(lists.getAllKeys())).filter(
        (k): k is string => typeof k === "string" && !k.includes(":"),
      );
      for (const ws of keys) {
        const value = await req(lists.get(ws));
        lists.put(value, ownerKey(userId, ws));
        lists.delete(ws);
      }
      for (const name of ["docOutbox", "metaOutbox"]) {
        const store = tx.objectStore(name);
        for (const e of await readAll<DocOutboxEntry | MetaOutboxEntry>(store)) {
          if (e.userId) continue;
          const { key, ...entry } = e;
          store.put({ ...entry, userId }, key);
        }
      }
      const state = tx.objectStore("noteState");
      for (const row of (await req(state.getAll())) as NoteStateRow[]) {
        if (row.lastPulledUpdateId === undefined && row.updatesSinceCompact === undefined) continue;
        const owner = moved.get(row.noteId);
        const next = stripLegacy(row)!;
        if (owner) {
          next.cursors = {
            ...next.cursors,
            [owner]: {
              lastPulledUpdateId: row.lastPulledUpdateId ?? 0,
              updatesSinceCompact: row.updatesSinceCompact ?? 0,
            },
          };
        }
        state.put(next);
      }
    },
    undefined,
  );
}

let attaching: Promise<void> = Promise.resolve();

/**
 * Who is signed in now (the auth shell calls this on every change). Someone:
 * they adopt what was nobody's, then every other person's caches go (their
 * outboxes stay). Nobody: nothing changes (a null session isn't a sign-out).
 */
export function attachNotesUser(userId: string | null): Promise<void> {
  attaching = attaching.then(async () => {
    if (userId) await adoptLegacy(userId);
    await people.attachUser(userId);
  });
  return attaching;
}

/** Signed out: everyone's caches go, the outboxes stay (`keepWaiting: false`: they go too). */
export function wipeNotesCopies(opts: { keepWaiting?: boolean } = {}): Promise<void> {
  attaching = attaching.then(() => people.wipe(opts));
  return attaching;
}

/** The person's workspace list came back: caches and outboxes of workspaces not on it go. */
export function keepNotesWorkspaces(
  userId: string,
  workspaceIds: readonly string[],
): Promise<void> {
  attaching = attaching.then(() => people.keepWorkspaces(userId, workspaceIds));
  return attaching;
}
