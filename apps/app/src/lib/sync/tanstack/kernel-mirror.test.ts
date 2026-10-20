// TS-3a: a store-driven kernel table mirrored into a collection. The mirror
// never reads, follows each change the moment `sync` is called (the snapshot
// is built right after), and keeps its rows map while nothing changed.

import { describe, expect, it } from "@rstest/core";
import { createSyncedCollection } from "../kernel/collection";
import { mirrorKernel } from "./kernel-mirror";

type Row = { id: string; updatedAt?: string; deletedAt?: string | null; v?: number };
const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, "0")}:00.000000+00:00`;

function setup() {
  let reads = 0;
  const kernel = createSyncedCollection<Row>({
    name: "t",
    read: async () => {
      reads += 1;
      return { rows: [], deleted: [], maxUpdatedAt: null, truncated: null };
    },
    lagMs: 60_000,
    maxPages: 20,
    goneTtlMs: 60_000,
  });
  const mirror = mirrorKernel<Row>(`t-${Math.random()}`, kernel);
  return { kernel, mirror, reads: () => reads };
}

describe("mirrorKernel", () => {
  it("is ready at once with what the kernel holds, and never reads", async () => {
    const { kernel, mirror, reads } = setup();
    expect(mirror.collection.isReady()).toBe(true);
    kernel.restore({ rows: [{ id: "a", updatedAt: at(1), v: 1 }], cursor: at(1) });
    mirror.sync();
    expect([...mirror.rows().keys()]).toEqual(["a"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(reads()).toBe(0);
    mirror.dispose();
  });

  it("follows lands and removals synchronously", () => {
    const { kernel, mirror } = setup();
    let changes = 0;
    mirror.onChange(() => {
      changes += 1;
    });
    kernel.applyRows([{ id: "a", updatedAt: at(1), v: 1 }], "answer");
    mirror.sync();
    expect(mirror.rows().get("a")?.v).toBe(1);
    kernel.applyRows([{ id: "a", updatedAt: at(2), v: 2 }], "answer");
    mirror.sync();
    expect(mirror.rows().get("a")?.v).toBe(2);
    kernel.forget(["a"]);
    mirror.sync();
    expect(mirror.rows().has("a")).toBe(false);
    expect(changes).toBe(3);
    mirror.dispose();
  });

  it("hands out the kernel's own row objects, in the kernel's order", () => {
    const { kernel, mirror } = setup();
    kernel.applyRows(
      [
        { id: "b", updatedAt: at(1), v: 1 },
        { id: "a", updatedAt: at(1), v: 2 },
      ],
      "answer",
    );
    mirror.sync();
    expect([...mirror.rows().keys()]).toEqual(["b", "a"]);
    expect(mirror.rows().get("a")).toBe(kernel.rows.get("a"));
    expect(Object.keys(mirror.rows().get("a") ?? {})).toEqual(["id", "updatedAt", "v"]);
    mirror.dispose();
  });

  it("drops a row the kernel held before the mirror began", () => {
    const kernel = createSyncedCollection<Row>({
      name: "t",
      lagMs: 60_000,
      maxPages: 20,
      goneTtlMs: 60_000,
    });
    kernel.applyRows([{ id: "a", updatedAt: at(1), v: 1 }], "answer");
    const mirror = mirrorKernel<Row>(`t-${Math.random()}`, kernel);
    expect([...mirror.rows().keys()]).toEqual(["a"]);
    kernel.forget(["a"]);
    mirror.sync();
    expect([...mirror.rows().keys()]).toEqual([]);
    mirror.dispose();
  });

  it("keeps the same rows map while nothing changed (an overlay alone)", () => {
    const { kernel, mirror } = setup();
    kernel.applyRows([{ id: "a", updatedAt: at(1), v: 1 }], "answer");
    mirror.sync();
    const first = mirror.rows();
    kernel.show(1, { patch: { id: "a", fields: { v: 9 } } });
    mirror.sync();
    expect(mirror.rows()).toBe(first);
    mirror.dispose();
  });
});
