// SK-C4's criterion: a user switch leaves no notes cache from the previous
// person. These run the real cache code over an in-memory IndexedDB
// (`testing-idb.ts`): the notes list, the pull cursors, the per-note document
// databases and the outboxes, for a switch, a sign-out and the caches from
// before Track C4, in a browser that lists its databases and one that can't.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "@rstest/core";

import {
  DOC_DB_PREFIX,
  docDbName,
  type DocOutboxEntry,
  type MetaOutboxEntry,
  NOTES_DB_NAME,
  type NoteStateRow,
  openNotesDb,
  setNotesSignedIn,
  writeMetaCache,
} from "./idb";
import { attachNotesUser, wipeNotesCopies } from "./people";
import { fakeIdb } from "./testing-idb";

const fake = fakeIdb();
const realIndexedDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;

beforeAll(async () => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = fake.factory;
  await openNotesDb();
});

afterAll(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = realIndexedDb;
});

afterEach(() => {
  fake.reset();
  setNotesSignedIn(undefined);
});

const A = "user-a:ws1";
const B = "user-b:ws1";

const meta = () => fake.rows(NOTES_DB_NAME, "metaCache");
const state = () => fake.rows(NOTES_DB_NAME, "noteState");
const docOutbox = () => fake.rows(NOTES_DB_NAME, "docOutbox");
const metaOutbox = () => fake.rows(NOTES_DB_NAME, "metaOutbox");
const docDbs = () => fake.names().filter((n) => n.startsWith(DOC_DB_PREFIX));

/** A and B both have a list, a cursor and a document cache for note n1; A has edits waiting. */
async function seedTwoPeople() {
  await writeMetaCache("user-a", "ws1", [{ id: "n1" }]);
  await writeMetaCache("user-b", "ws1", [{ id: "n1" }]);
  const row: NoteStateRow = {
    noteId: "n1",
    nextClientSeq: 7,
    cursors: {
      [A]: { lastPulledUpdateId: 5, updatesSinceCompact: 1 },
      [B]: { lastPulledUpdateId: 9, updatesSinceCompact: 2 },
    },
  };
  state().set("n1", row);
  fake.createDatabase(docDbName(A, "n1"));
  fake.createDatabase(docDbName(B, "n1"));
  const edit: DocOutboxEntry = {
    userId: "user-a",
    workspaceId: "ws1",
    noteId: "n1",
    clientSeq: 6,
    updateB64: "AA==",
    queuedAt: 1,
  };
  const op: MetaOutboxEntry = {
    userId: "user-a",
    workspaceId: "ws1",
    kind: "rename",
    args: { id: "n1", title: "A's title" },
    queuedAt: 2,
  };
  docOutbox().set(1, edit);
  metaOutbox().set(1, op);
}

describe("another person signs in", () => {
  for (const lists of [true, false]) {
    it(`takes the previous person's list, cursors and documents; their edits keep waiting (${
      lists ? "browser lists databases" : "browser can't list databases"
    })`, async () => {
      fake.listDatabases(lists);
      await seedTwoPeople();

      await attachNotesUser("user-b");

      expect([...meta().keys()]).toEqual([B]);
      const row = state().get("n1") as NoteStateRow;
      expect(Object.keys(row.cursors ?? {})).toEqual([B]);
      expect(row.nextClientSeq).toBe(7);
      expect(docDbs()).toEqual([docDbName(B, "n1")]);
      expect(docOutbox().size).toBe(1);
      expect(metaOutbox().size).toBe(1);
    });
  }

  it("a null session wipes nothing", async () => {
    await seedTwoPeople();
    await attachNotesUser(null);
    expect([...meta().keys()].sort()).toEqual([A, B]);
    expect(docDbs()).toHaveLength(2);
  });
});

describe("a sign-out", () => {
  for (const lists of [true, false]) {
    it(`takes everyone's caches and keeps the outboxes (${lists ? "listing" : "no listing"})`, async () => {
      fake.listDatabases(lists);
      await seedTwoPeople();

      await wipeNotesCopies();

      expect(meta().size).toBe(0);
      const row = state().get("n1") as NoteStateRow;
      expect(row.cursors ?? {}).toEqual({});
      expect(docDbs()).toEqual([]);
      expect(docOutbox().size).toBe(1);
      expect(metaOutbox().size).toBe(1);
    });

    it(`an account deletion takes the outboxes too (${lists ? "listing" : "no listing"})`, async () => {
      fake.listDatabases(lists);
      await seedTwoPeople();

      await wipeNotesCopies({ keepWaiting: false });

      expect(meta().size).toBe(0);
      expect(docDbs()).toEqual([]);
      expect(docOutbox().size).toBe(0);
      expect(metaOutbox().size).toBe(0);
      // The device's seq counter outlives the account.
      expect((state().get("n1") as NoteStateRow).nextClientSeq).toBe(7);
    });
  }
});

describe("caches from before Track C4 (nobody's)", () => {
  /** A list keyed by workspace alone, a device-wide cursor, a document cache `ws:note`, edits waiting. */
  async function seedLegacy() {
    meta().set("ws1", { notes: [{ id: "n9" }], savedAt: 1 });
    state().set("n9", {
      noteId: "n9",
      nextClientSeq: 3,
      lastPulledUpdateId: 4,
      updatesSinceCompact: 1,
    });
    fake.createDatabase(`${DOC_DB_PREFIX}ws1:n9`);
    docOutbox().set(1, {
      workspaceId: "ws1",
      noteId: "n9",
      clientSeq: 2,
      updateB64: "AA==",
      queuedAt: 1,
    } satisfies DocOutboxEntry);
  }

  for (const lists of [true, false]) {
    it(`go on the next sign-in; the edits waiting stay (${lists ? "listing" : "no listing"})`, async () => {
      fake.listDatabases(lists);
      await seedLegacy();

      await attachNotesUser("user-b");

      expect(meta().has("ws1")).toBe(false);
      expect(docDbs()).toEqual([]);
      const row = state().get("n9") as NoteStateRow;
      expect(row.lastPulledUpdateId).toBeUndefined();
      expect(row.updatesSinceCompact).toBeUndefined();
      expect(row.nextClientSeq).toBe(3);
      expect(docOutbox().size).toBe(1);
    });
  }
});
