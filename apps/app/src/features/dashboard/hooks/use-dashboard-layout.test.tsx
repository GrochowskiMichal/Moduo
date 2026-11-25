// Coming back to Home draws the layout at once (no skeleton): the layout
// outlives the page, and a device's cached layout paints without waiting for
// the cloud read.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook } from "@testing-library/react";

import type { StoredDashboardLayout } from "@/lib/runtime.types";

const fake = rs.hoisted(() => {
  const state = {
    ls: new Map<string, unknown>(),
    cloudGets: 0,
    /** Pending cloud reads; resolve to answer. */
    cloud: [] as Array<(row: StoredDashboardLayout | null) => void>,
  };
  const runtime = {
    localStore: {
      async get(ns: string, key: string) {
        return state.ls.get(`${ns}:${key}`) ?? null;
      },
      async set(ns: string, key: string, value: unknown) {
        state.ls.set(`${ns}:${key}`, value);
      },
      async remove(ns: string, key: string) {
        state.ls.delete(`${ns}:${key}`);
      },
    },
    dashboard: {
      get() {
        state.cloudGets += 1;
        return new Promise<StoredDashboardLayout | null>((resolve) => state.cloud.push(resolve));
      },
      async save() {},
    },
  };
  const workspace = { selectedWorkspaceId: "ws1" };
  const auth = { userId: "u1" };
  return { state, runtime, workspace, auth };
});

rs.mock("@/lib/runtime", () => ({ getRuntime: () => fake.runtime }));
rs.mock("@/features/workspaces/workspace-context", () => ({
  useWorkspace: () => fake.workspace,
}));
rs.mock("@/providers/auth-provider", () => ({ useAuth: () => fake.auth }));

import { sessionResources } from "@/lib/resource-cache";

import type { DashboardLayout } from "../engine/types";
import { useDashboardLayout } from "./use-dashboard-layout";

const settle = () => act(async () => {});

const MINE: DashboardLayout = {
  version: 1,
  pages: [
    {
      id: "home",
      widgets: [{ id: "w-clock", type: "clock", size: "S", x: 0, y: 0, config: {} }],
    },
  ],
};

beforeEach(() => {
  sessionResources.clear();
  fake.state.ls.clear();
  fake.state.cloudGets = 0;
  fake.state.cloud.length = 0;
});
afterEach(cleanup);

describe("Home's layout on return", () => {
  it("paints the device's cached layout without waiting for the cloud", async () => {
    fake.state.ls.set("dashboard:ws1", { layout: MINE, updatedAt: "2026-11-01T00:00:00.000Z" });
    const { result } = renderHook(() => useDashboardLayout());
    await settle();
    // The cloud read is still out, yet the layout shows.
    expect(fake.state.cloud.length).toBe(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.layout.pages[0].widgets.map((w) => w.id)).toEqual(["w-clock"]);
  });

  it("a second visit draws on its first render, with no skeleton", async () => {
    const first = renderHook(() => useDashboardLayout());
    await settle();
    await act(async () => {
      fake.state.cloud[0]({ layout: MINE, updatedAt: "2026-11-01T00:00:00.000Z" });
    });
    expect(first.result.current.loading).toBe(false);
    first.unmount();

    const second = renderHook(() => useDashboardLayout());
    // First render, before any effect or read has answered.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.layout.pages[0].widgets.map((w) => w.id)).toEqual(["w-clock"]);
  });

  it("a newer cloud layout replaces the cached one", async () => {
    fake.state.ls.set("dashboard:ws1", { layout: MINE, updatedAt: "2026-11-01T00:00:00.000Z" });
    const { result } = renderHook(() => useDashboardLayout());
    await settle();
    const newer: DashboardLayout = {
      version: 1,
      pages: [
        {
          id: "home",
          widgets: [{ id: "w-notes", type: "notes", size: "M", x: 0, y: 0, config: {} }],
        },
      ],
    };
    await act(async () => {
      fake.state.cloud[0]({ layout: newer, updatedAt: "2026-11-02T00:00:00.000Z" });
    });
    expect(result.current.layout.pages[0].widgets.map((w) => w.id)).toEqual(["w-notes"]);
  });

  it("an edit made while the cloud read is out is not overwritten by it", async () => {
    fake.state.ls.set("dashboard:ws1", { layout: MINE, updatedAt: "2026-11-01T00:00:00.000Z" });
    const { result } = renderHook(() => useDashboardLayout());
    await settle();
    act(() => {
      result.current.addPage();
    });
    expect(result.current.layout.pages).toHaveLength(2);
    await act(async () => {
      fake.state.cloud[0]({ layout: MINE, updatedAt: "2026-11-01T00:00:00.000Z" });
    });
    expect(result.current.layout.pages).toHaveLength(2);
    // The device copy keeps the edit too (offline it is the only copy).
    const cached = fake.state.ls.get("dashboard:ws1") as { layout: DashboardLayout };
    expect(cached.layout.pages).toHaveLength(2);
  });
});
