import { describe, expect, it, rs } from "@rstest/core";

import { sessionBusyIntervals } from "./booking-sessions.ts";

/** A Supabase query stand-in: records the calls, answers with `answer`. */
function fakeDb(answer: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  // A real promise with the builder's chain methods on it.
  const query = Promise.resolve(answer) as Promise<unknown> & Record<string, unknown>;
  for (const method of ["select", "eq", "is", "lt", "gt"]) {
    query[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return query;
    };
  }
  return {
    calls,
    db: {
      from(table: string) {
        calls.push(["from", [table]]);
        return query;
      },
    },
  };
}

const range = {
  workspaceId: "ws-1",
  userId: "host-1",
  from: new Date("2030-03-04T00:00:00Z"),
  to: new Date("2030-03-18T00:00:00Z"),
};

describe("sessionBusyIntervals (TV-D10, default d)", () => {
  it("reads only the host's live sessions in the window, and only their times", async () => {
    const { db, calls } = fakeDb({ data: [], error: null });
    await sessionBusyIntervals(db, range);
    expect(calls).toEqual([
      ["from", ["task_sessions"]],
      ["select", ["starts_at, ends_at, tasks!inner(status_category, deleted_at)"]],
      ["eq", ["workspace_id", "ws-1"]],
      ["eq", ["user_id", "host-1"]],
      ["is", ["deleted_at", null]],
      ["lt", ["starts_at", "2030-03-18T00:00:00.000Z"]],
      ["gt", ["ends_at", "2030-03-04T00:00:00.000Z"]],
    ]);
  });

  it("turns open tasks' sessions into busy times; finished or deleted tasks block nothing", async () => {
    const { db } = fakeDb({
      error: null,
      data: [
        {
          starts_at: "2030-03-05T09:00:00Z",
          ends_at: "2030-03-05T10:30:00Z",
          tasks: { status_category: "in_progress", deleted_at: null },
        },
        {
          starts_at: "2030-03-06T09:00:00Z",
          ends_at: "2030-03-06T10:00:00Z",
          tasks: { status_category: "done", deleted_at: null },
        },
        {
          starts_at: "2030-03-07T09:00:00Z",
          ends_at: "2030-03-07T10:00:00Z",
          tasks: { status_category: "todo", deleted_at: "2030-03-01T00:00:00Z" },
        },
        {
          starts_at: "2030-03-08T09:00:00Z",
          ends_at: "2030-03-08T10:00:00Z",
          tasks: { status_category: "wont_do", deleted_at: null },
        },
      ],
    });
    const busy = await sessionBusyIntervals(db, range);
    expect(busy).toEqual([
      { start: new Date("2030-03-05T09:00:00Z"), end: new Date("2030-03-05T10:30:00Z") },
    ]);
    // Nothing but the times leaves the function.
    expect(Object.keys(busy[0]!).sort()).toEqual(["end", "start"]);
  });

  it("blocks nothing when the read fails (a database before TV-D10)", async () => {
    const quiet = rs.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      data: null,
      error: { code: "PGRST205", message: "relation task_sessions does not exist" },
    });
    expect(await sessionBusyIntervals(db, range)).toEqual([]);
    quiet.mockRestore();
  });
});
