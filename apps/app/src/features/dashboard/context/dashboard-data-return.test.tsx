// Coming back to Home shows the widgets' data on the first render: a source's
// last answer outlives the page, and the read it starts runs behind it.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render } from "@testing-library/react";

const fake = rs.hoisted(() => {
  const state = {
    reads: 0,
    pending: [] as Array<(rows: unknown[]) => void>,
  };
  const runtime = {
    notesV2: {
      recent() {
        state.reads += 1;
        return new Promise<unknown[]>((resolve) => state.pending.push(resolve));
      },
    },
  };
  return { state, runtime, auth: { userId: "u1" } };
});

rs.mock("@/lib/runtime", () => ({ getRuntime: () => fake.runtime }));
rs.mock("@/providers/auth-provider", () => ({ useAuth: () => fake.auth }));

import { sessionResources } from "@/lib/resource-cache";

import type { DashboardLayout } from "../engine/types";
import { DashboardDataProvider, useDashboardSource } from "./dashboard-data-context";

const LAYOUT: DashboardLayout = {
  version: 1,
  pages: [{ id: "home", widgets: [{ id: "n", type: "notes", size: "M", x: 0, y: 0, config: {} }] }],
};

const seen: Array<{ loading: boolean; count: number }> = [];
function NotesReader() {
  const src = useDashboardSource("recentNotes");
  seen.push({ loading: src.loading, count: src.data.length });
  return null;
}

const tree = () => (
  <DashboardDataProvider layout={LAYOUT} workspaceId="ws1">
    <NotesReader />
  </DashboardDataProvider>
);

beforeEach(() => {
  sessionResources.clear();
  fake.state.reads = 0;
  fake.state.pending.length = 0;
  seen.length = 0;
});

describe("Home's widget data on return", () => {
  it("draws the last answer at once and refreshes behind it", async () => {
    const first = render(tree());
    await act(async () => {});
    expect(seen.at(-1)).toEqual({ loading: true, count: 0 });
    await act(async () => {
      fake.state.pending[0]([{ id: "a" }, { id: "b" }]);
    });
    expect(seen.at(-1)).toEqual({ loading: false, count: 2 });
    first.unmount();
    cleanup();

    seen.length = 0;
    render(tree());
    // The very first render already has the data, and never a skeleton after.
    expect(seen[0]).toEqual({ loading: false, count: 2 });
    await act(async () => {});
    expect(fake.state.reads).toBe(2); // the quiet refresh
    expect(seen.every((s) => !s.loading && s.count === 2)).toBe(true);
    cleanup();
  });
});
