// HV-15 variant of benchmarks/escapes/645-3-error-as-empty: when the uploads
// database fails to open, `idbUploadStore().all()` answers [] (and the failed
// open is cached), so the "Reset local cache" guard reads 0 files waiting and
// that no other account has any: the reset deletes `moduo-uploads` with files
// that never reached the server. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/lib/uploads/store.645-3.variant.test.ts

import { afterAll, describe, expect, it } from "@rstest/core";

import { fakeIdb } from "../../features/notes/sync/testing-idb";
import { closeUploadsDb, countPendingUploads, otherAccountsHaveUploads } from "./index";
import type { UploadItem } from "./queue";
import { idbUploadStore } from "./store";

const fake = fakeIdb();
const realIndexedDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
let failOpen = false;

// Opens like the fake until told to fail, as a browser's backing store can.
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

function waiting(id: string, userId: string): UploadItem {
  return {
    id,
    userId,
    state: "queued",
    fileName: `${id}.pdf`,
  } as unknown as UploadItem;
}

afterAll(async () => {
  await closeUploadsDb();
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = realIndexedDb;
});

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt(
  "HV-15 variant 645-3-error-as-empty: a failed uploads DB open reads as no files waiting",
  () => {
    it("a file waiting on disk still blocks the reset when the uploads database fails to open", async () => {
      (globalThis as { indexedDB?: IDBFactory }).indexedDB = flaky;
      failOpen = false;
      // My file and another account's file wait on this device.
      expect(await idbUploadStore().put(waiting("mine", "user-a"))).toBe(true);
      expect(await idbUploadStore().put(waiting("theirs", "user-b"))).toBe(true);
      expect(await countPendingUploads("user-a")).toBe(1);
      expect(await otherAccountsHaveUploads("user-a")).toBe(true);

      // The next open fails (a reload, the reset flow reopening it).
      await closeUploadsDb();
      failOpen = true;
      expect(fake.rows("moduo-uploads", "items").size).toBe(2);

      // The guard must not read "nothing waits": a 0 lets the reset delete the file.
      expect(await countPendingUploads("user-a")).not.toBe(0);
    });

    it("another account's waiting file keeps the uploads store when it can't be read", async () => {
      // Still failing: "no other account has files" deletes `moduo-uploads`.
      expect(await otherAccountsHaveUploads("user-a")).toBe(true);
    });
  },
);
