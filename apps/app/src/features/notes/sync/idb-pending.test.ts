// The "Reset local cache" guard reads countPendingOutbox before it wipes the
// notes databases (DF-19g). A database that fails to open must read as
// "unknown", never as 0: 0 lets the reset delete unsynced notes (HV-12).

import { afterAll, describe, expect, it } from "@rstest/core";

import { countPendingOutbox, enqueueMetaOp, type NotesOwner, setNotesSignedIn } from "./idb";
import { fakeIdb } from "./testing-idb";

const fake = fakeIdb();
const realIndexedDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
let failOpen = false;

// The notes opener keeps the first factory it sees: this one fails on demand.
const flaky = {
  ...fake.factory,
  open(name: string, version?: number) {
    if (!failOpen) return fake.factory.open(name, version);
    const request: { error?: unknown; onerror?: () => void } = {};
    queueMicrotask(() => {
      request.error = new Error("UnknownError: Internal error opening backing store");
      request.onerror?.();
    });
    return request as unknown as IDBOpenDBRequest;
  },
} as IDBFactory;

afterAll(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = realIndexedDb;
  setNotesSignedIn(undefined);
});

describe("countPendingOutbox", () => {
  it("is 0 on a device with no IndexedDB (nothing can be queued there)", async () => {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
    expect(await countPendingOutbox()).toBe(0);
  });

  it('is "unknown" when the notes database fails to open, so the reset stays blocked', async () => {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = flaky;
    failOpen = true;
    expect(await countPendingOutbox()).toBe("unknown");
  });

  it("counts the queued changes once the database opens", async () => {
    failOpen = false;
    expect(await countPendingOutbox()).toBe(0);
    setNotesSignedIn("user-a");
    const owner: NotesOwner = { userId: "user-a", workspaceId: "ws1" };
    await enqueueMetaOp(owner, { kind: "rename", args: { noteId: "n1" }, queuedAt: 1 });
    expect(await countPendingOutbox()).toBe(1);
  });
});
