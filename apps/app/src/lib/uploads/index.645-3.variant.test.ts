// HV-15 variant of benchmarks/escapes/645-3-error-as-empty: a failed uploads DB open reads as "no files waiting". Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/lib/uploads/index.645-3.variant.test.ts
//
// Settings → Advanced → "Reset local cache" reads countPendingUploads before
// it deletes `moduo-uploads`. When that database fails to open, it reads as
// "nothing waiting", so the reset is not blocked and deletes files that never
// reached the server.

import { afterAll, describe, expect, it } from "@rstest/core";

import { countPendingUploads } from "./index";

const realIndexedDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;

// A device that has IndexedDB, but whose database fails to open.
const failing = {
  open() {
    const request: { error?: unknown; onerror?: () => void } = {};
    queueMicrotask(() => {
      request.error = new Error("UnknownError: Internal error opening backing store");
      request.onerror?.();
    });
    return request as unknown as IDBOpenDBRequest;
  },
} as unknown as IDBFactory;

afterAll(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = realIndexedDb;
});

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 645-3: a failed uploads DB open lets Reset delete waiting files", () => {
  it("does not read a failed open as 0 waiting files, so the reset stays blocked", async () => {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = failing;
    const waiting: unknown = await countPendingUploads("user-a");
    // The fix may say "unknown" (as countPendingOutbox does) or throw; 0 is the bug.
    expect(waiting).not.toBe(0);
  });
});
