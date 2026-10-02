import { describe, expect, it } from "vitest";

import type { ModuoRuntime, StoredDashboardLayout } from "@/lib/runtime.types";

import type { DashboardLayout, WidgetInstance } from "../engine/types";
import { createLayoutRepo, resolveLoad } from "./layout-repo";

function widget(
  id: string,
  x: number,
  y: number,
  size: WidgetInstance["size"] = "S",
): WidgetInstance {
  return { id, type: "clock", size, x, y, config: {} };
}

function layout(widgets: WidgetInstance[]): DashboardLayout {
  return { version: 1, pages: [{ id: "home", widgets }] };
}

function stored(l: DashboardLayout, updatedAt: string): StoredDashboardLayout {
  return { layout: l, updatedAt };
}

/** A fake runtime with an in-memory localStore + a controllable cloud row. */
function fakeRuntime(
  init: { cloud?: StoredDashboardLayout | null; throwGet?: boolean; throwSave?: boolean } = {},
) {
  const ls = new Map<string, unknown>();
  const cloud = {
    row: init.cloud ?? null,
    throwGet: init.throwGet ?? false,
    throwSave: init.throwSave ?? false,
    saveCount: 0,
  };
  const runtime = {
    localStore: {
      async get(ns: string, key: string) {
        return ls.get(`${ns}:${key}`) ?? null;
      },
      async set(ns: string, key: string, value: unknown) {
        ls.set(`${ns}:${key}`, value);
      },
      async remove(ns: string, key: string) {
        ls.delete(`${ns}:${key}`);
      },
    },
    dashboard: {
      async get() {
        if (cloud.throwGet) throw new Error("offline");
        return cloud.row;
      },
      async save({
        layout: l,
        updatedAt,
      }: {
        workspaceId: string;
        layout: DashboardLayout;
        updatedAt: string;
      }) {
        cloud.saveCount += 1;
        if (cloud.throwSave) throw new Error("upsert failed");
        cloud.row = { layout: l, updatedAt };
      },
    },
  } as unknown as ModuoRuntime;
  return { runtime, ls, cloud };
}

describe("resolveLoad", () => {
  const NOW = "2026-07-09T12:00:00.000Z";

  it("seeds the curated default when neither cache nor cloud exists", () => {
    const r = resolveLoad(null, null, NOW);
    expect(r.origin).toBe("seed");
    expect(r.updatedAt).toBe(NOW);
    // The seed is the 4-widget curated page.
    expect(r.layout.pages[0].widgets.map((w) => w.type).sort()).toEqual([
      "calendar",
      "clock",
      "quick-capture",
      "tasks",
    ]);
  });

  it("takes cloud when it's the only source", () => {
    const cloud = stored(layout([widget("a", 0, 0)]), "2026-07-01T00:00:00.000Z");
    expect(resolveLoad(null, cloud, NOW).origin).toBe("cloud");
  });

  it("takes cache when it's the only source (offline)", () => {
    const cache = stored(layout([widget("a", 0, 0)]), "2026-07-01T00:00:00.000Z");
    expect(resolveLoad(cache, null, NOW).origin).toBe("cache");
  });

  it("cloud-newer wins", () => {
    const cache = stored(layout([widget("a", 0, 0)]), "2026-07-01T00:00:00.000Z");
    const cloud = stored(layout([widget("b", 2, 0)]), "2026-07-05T00:00:00.000Z");
    const r = resolveLoad(cache, cloud, NOW);
    expect(r.origin).toBe("cloud");
    expect(r.layout.pages[0].widgets[0].id).toBe("b");
  });

  it("cache-newer wins (offline edits not yet pushed)", () => {
    const cache = stored(layout([widget("a", 0, 0)]), "2026-07-08T00:00:00.000Z");
    const cloud = stored(layout([widget("b", 2, 0)]), "2026-07-05T00:00:00.000Z");
    const r = resolveLoad(cache, cloud, NOW);
    expect(r.origin).toBe("cache");
    expect(r.layout.pages[0].widgets[0].id).toBe("a");
  });

  it("sanitizes a corrupt winning blob into a legal grid (AC11)", () => {
    // Two overlapping + one out-of-bounds + one unknown-type widget.
    const corrupt = {
      version: 1,
      pages: [
        {
          id: "home",
          widgets: [
            { id: "a", type: "tasks", size: "L", x: 0, y: 0, config: {} },
            { id: "b", type: "tasks", size: "L", x: 0, y: 0, config: {} }, // overlaps a
            { id: "c", type: "clock", size: "S", x: 99, y: 99, config: {} }, // out of bounds
            { id: "d", type: "not-a-real-widget", size: "S", x: 0, y: 0, config: {} }, // dropped
          ],
        },
      ],
    } as unknown as DashboardLayout;
    const r = resolveLoad(stored(corrupt, "2026-07-09T00:00:00.000Z"), null, NOW);
    const widgets = r.layout.pages[0].widgets;
    // Unknown type dropped; the rest placed legally (in-bounds, no overlaps).
    expect(widgets.find((w) => w.id === "d")).toBeUndefined();
    for (const w of widgets) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("createLayoutRepo", () => {
  const now = () => "2026-07-09T12:00:00.000Z";

  it("first run seeds the default and caches it", async () => {
    const { runtime, ls } = fakeRuntime();
    const repo = createLayoutRepo(runtime, { now, debounceMs: 0 });
    const loaded = await repo.load("w1");
    expect(loaded.origin).toBe("seed");
    // The seed was written back to the cache under the workspace key.
    expect(ls.get("dashboard:w1")).toBeTruthy();
  });

  it("save writes the cache immediately and (debounce 0) pushes cloud", async () => {
    const { runtime, cloud, ls } = fakeRuntime();
    const repo = createLayoutRepo(runtime, { now, debounceMs: 0 });
    await repo.save("w1", layout([widget("a", 0, 0)]));
    expect((ls.get("dashboard:w1") as StoredDashboardLayout).layout.pages[0].widgets[0].id).toBe(
      "a",
    );
    expect(cloud.saveCount).toBe(1);
    expect(cloud.row?.layout.pages[0].widgets[0].id).toBe("a");
  });

  it("a failed cloud upsert keeps local truth (reloads from cache)", async () => {
    const { runtime, cloud } = fakeRuntime({ throwSave: true });
    const repo = createLayoutRepo(runtime, { now, debounceMs: 0 });
    await repo.save("w1", layout([widget("z", 4, 0)]));
    expect(cloud.saveCount).toBe(1); // it tried
    expect(cloud.row).toBeNull(); // …and failed — nothing landed in cloud
    // But the cache holds it, so a reload returns the local truth, not a re-seed.
    const loaded = await repo.load("w1");
    expect(loaded.origin).toBe("cache");
    expect(loaded.layout.pages[0].widgets[0].id).toBe("z");
  });

  it("a load NEVER writes to the cloud, even when the local cache leads (DF-12)", async () => {
    const { runtime, cloud } = fakeRuntime();
    const repo = createLayoutRepo(runtime, { now, debounceMs: 0 });
    // A local cache newer than an older cloud row = an offline edit whose flush
    // was cut off. The load must serve it locally but issue NO upsert — the read
    // path is not allowed to write (the boot fetch-storm write-on-read). The edit
    // rides up on the next `save`, not on read.
    await runtime.localStore.set(
      "dashboard",
      "w1",
      stored(layout([widget("x", 0, 0)]), "2026-07-09T13:00:00.000Z"),
    );
    cloud.row = stored(layout([widget("y", 2, 0)]), "2026-07-01T00:00:00.000Z");
    const before = cloud.saveCount;
    const loaded = await repo.load("w1");
    expect(loaded.origin).toBe("cache");
    expect(loaded.layout.pages[0].widgets[0].id).toBe("x"); // local truth served
    expect(cloud.saveCount).toBe(before); // …but no write during the read
    expect(cloud.row?.layout.pages[0].widgets[0].id).toBe("y"); // cloud untouched
  });

  it("a cloud read error degrades to the local cache (offline)", async () => {
    const { runtime } = fakeRuntime({ throwGet: true });
    const repo = createLayoutRepo(runtime, { now, debounceMs: 0 });
    await repo.save("w1", layout([widget("k", 0, 0)]));
    const loaded = await repo.load("w1"); // cloud.get throws → cache wins
    expect(loaded.origin).toBe("cache");
    expect(loaded.layout.pages[0].widgets[0].id).toBe("k");
  });
});
