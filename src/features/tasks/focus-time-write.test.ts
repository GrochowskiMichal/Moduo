import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { writeTaskTimeTotal } from "./focus-time-write";

// The focus save must touch only the time total, scoped to the task and its
// workspace — never the rest of the row (TV-F1).
const h = rs.hoisted(() => ({
  calls: [] as Array<{ table: string; patch: unknown; filters: Array<[string, unknown]> }>,
  result: { data: null as unknown, error: null as unknown },
}));

rs.mock("../../lib/runtime.web", () => ({
  supabaseClient: {
    from: (table: string) => {
      const call = { table, patch: undefined as unknown, filters: [] as Array<[string, unknown]> };
      h.calls.push(call);
      const chain = {
        update: (patch: unknown) => {
          call.patch = patch;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        select: () => chain,
        maybeSingle: () => Promise.resolve(h.result),
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  h.calls = [];
  h.result = { data: null, error: null };
});

describe("writeTaskTimeTotal", () => {
  it("updates only the time total and updated_at, filtered by task and workspace", async () => {
    h.result = {
      data: { time_spent_seconds: 160, updated_at: "2026-10-08T12:00:00.000Z" },
      error: null,
    };
    const saved = await writeTaskTimeTotal("t1", "ws-1", 160);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.table).toBe("tasks");
    expect(Object.keys(h.calls[0]?.patch as object).sort()).toEqual([
      "time_spent_seconds",
      "updated_at",
    ]);
    expect(h.calls[0]?.patch).toMatchObject({ time_spent_seconds: 160 });
    expect(h.calls[0]?.filters).toEqual([
      ["id", "t1"],
      ["workspace_id", "ws-1"],
    ]);
    expect(saved).toEqual({ timeSpentSeconds: 160, updatedAt: "2026-10-08T12:00:00.000Z" });
  });

  it("returns null when no visible row matched", async () => {
    await expect(writeTaskTimeTotal("gone", "ws-1", 30)).resolves.toBeNull();
  });

  it("throws when the write fails", async () => {
    h.result = { data: null, error: { message: "permission denied" } };
    await expect(writeTaskTimeTotal("t1", "ws-1", 30)).rejects.toThrow("permission denied");
  });
});
