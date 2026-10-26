// HV-15 variant of benchmarks/escapes/509-1-error-read-as-empty: a failed cloud read on a
// device with no cached layout seeds the default with a fresh stamp, which then beats the
// account's real (older-stamped) layout and rides up over it on the next edit. Fixed in MOD-558; kept as a regression test.
// Run: bun run --cwd apps/app test src/features/dashboard/data/layout-repo.509-1.variant.test.ts
import { describe, expect, it } from "@rstest/core";

import type { ModuoRuntime, StoredDashboardLayout } from "@/lib/runtime.types";

import type { DashboardLayout } from "../engine/types";
import { createLayoutRepo } from "./layout-repo";

const REAL: StoredDashboardLayout = {
  layout: {
    version: 1,
    pages: [
      { id: "home", widgets: [{ id: "mine", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
    ],
  },
  // Saved yesterday on another device.
  updatedAt: "2026-10-19T09:00:00.000Z",
};

function fakeRuntime() {
  const ls = new Map<string, unknown>();
  const cloud = { row: REAL as StoredDashboardLayout | null, failGet: false };
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
        if (cloud.failGet) throw new Error("TypeError: Failed to fetch");
        return cloud.row;
      },
      async save(input: { workspaceId: string; layout: DashboardLayout; updatedAt: string }) {
        cloud.row = { layout: input.layout, updatedAt: input.updatedAt };
      },
    },
  } as unknown as ModuoRuntime;
  return { runtime, cloud };
}

const widgetIds = (l: DashboardLayout) => l.pages.flatMap((p) => p.widgets.map((w) => w.id));

describe("HV-15 variant 509-1: a failed dashboard read seeds a default that outranks the real layout", () => {
  it("after a failed first read, the next good read shows the account's layout and an edit keeps it", async () => {
    const { runtime, cloud } = fakeRuntime();
    const repo = createLayoutRepo(runtime, {
      now: () => "2026-10-20T08:00:00.000Z",
      debounceMs: 0,
    });

    // A new device opens Home during a blip: no cache, the cloud read fails.
    cloud.failGet = true;
    await repo.load("w1");

    // The connection is back: the account's real layout must win.
    cloud.failGet = false;
    const loaded = await repo.load("w1");
    expect(widgetIds(loaded.layout)).toContain("mine");

    // The person moves one widget: the real layout must still be in the cloud.
    await repo.save("w1", loaded.layout);
    expect(widgetIds(cloud.row!.layout)).toContain("mine");
  });
});
