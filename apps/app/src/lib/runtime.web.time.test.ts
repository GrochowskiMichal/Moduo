// TV-D3: tracked time goes through `tasks_op_track_time`, and until the
// migration reaches the database the runtime writes the old total column, and
// only that column. Runs the real runtime over a recording stand-in for the
// Supabase client.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

type Call = [string, unknown[]];
type Query = { table: string; calls: Call[] };
type Result = { data: unknown; error: { code?: string; message: string } | null };
const recorded = rs.hoisted(() => ({
  queries: [] as Query[],
  /** What each next `from(table)` chain resolves to, in order. */
  results: {} as Record<string, Result[]>,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResults: {} as Record<string, Result>,
  signals: [] as AbortSignal[],
}));

rs.mock("@supabase/supabase-js", () => {
  const chain = (q: Query, result: Result): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            q.calls.push([String(prop), args]);
            return chain(q, result);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const client = new Proxy(
    {
      from: (table: string) => {
        const q: Query = { table, calls: [] };
        recorded.queries.push(q);
        const result = recorded.results[table]?.shift() ?? { data: null, error: null };
        return chain(q, result);
      },
      rpc: (fn: string, args: Record<string, unknown>) => {
        recorded.rpcs.push({ fn, args });
        const result = Promise.resolve(recorded.rpcResults[fn] ?? { data: null, error: null });
        return Object.assign(result, {
          abortSignal: (signal: AbortSignal) => {
            recorded.signals.push(signal);
            return result;
          },
        });
      },
      auth: new Proxy({ onAuthStateChange: noop }, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

const MISSING = (fn: string): Result => ({
  data: null,
  error: {
    code: "PGRST202",
    message: `Could not find the function public.${fn} in the schema cache`,
  },
});

beforeEach(() => {
  recorded.queries.length = 0;
  recorded.rpcs.length = 0;
  recorded.results = {};
  recorded.rpcResults = {};
  recorded.signals.length = 0;
});

describe("trackTime (TV-D3)", () => {
  it("sends a focus stretch with its key and end, and maps the answer", async () => {
    recorded.rpcResults.tasks_op_track_time = {
      data: {
        status: "saved",
        task_id: "t1",
        entry_id: "e1",
        total_seconds: 160,
        my_seconds: 60,
        my_waiting_seconds: 0,
      },
      error: null,
    };
    const result = await webRuntime.tasks.trackTime({
      workspaceId: "w1",
      taskId: "t1",
      action: "focus",
      seconds: 60,
      endedAt: "2026-10-08T10:30:00.000Z",
      key: "save-key-1",
    });
    expect(recorded.rpcs).toEqual([
      {
        fn: "tasks_op_track_time",
        args: {
          p_workspace_id: "w1",
          p_task_id: "t1",
          p_action: "focus",
          p_seconds: 60,
          p_ended_at: "2026-10-08T10:30:00.000Z",
          p_client_key: "save-key-1",
          p_entry_id: null,
        },
      },
    ]);
    expect(result).toEqual({
      status: "saved",
      taskId: "t1",
      entryId: "e1",
      totalSeconds: 160,
      mySeconds: 60,
      myWaitingSeconds: 0,
    });
    expect(recorded.queries).toHaveLength(0); // never a task-row write
    expect(recorded.signals).toHaveLength(1); // a hung request times out
  });

  it("undoes an adjustment by its entry, and a gone task has no totals", async () => {
    recorded.rpcResults.tasks_op_track_time = {
      data: { status: "gone", task_id: "t1" },
      error: null,
    };
    const result = await webRuntime.tasks.trackTime({
      workspaceId: "w1",
      taskId: "t1",
      action: "undo",
      entryId: "e1",
      seconds: 900,
    });
    expect(recorded.rpcs[0]?.args).toMatchObject({
      p_action: "undo",
      p_seconds: null,
      p_entry_id: "e1",
    });
    expect(result).toMatchObject({ status: "gone", entryId: null, totalSeconds: null });
  });

  it("before the migration: reads the total and writes only the time column", async () => {
    recorded.rpcResults.tasks_op_track_time = MISSING("tasks_op_track_time");
    recorded.results.tasks = [
      { data: { time_spent_seconds: 100 }, error: null },
      { data: { time_spent_seconds: 160 }, error: null },
    ];
    const result = await webRuntime.tasks.trackTime({
      workspaceId: "w1",
      taskId: "t1",
      action: "focus",
      seconds: 60,
      key: "save-key-1",
    });
    expect(result).toMatchObject({ status: "saved", totalSeconds: 160 });
    const write = recorded.queries[1]?.calls.find(([m]) => m === "update");
    expect(write?.[1]).toEqual([{ time_spent_seconds: 160 }]);
  });

  it("before the migration: a typed total, an Undo and a missing task", async () => {
    recorded.rpcResults.tasks_op_track_time = MISSING("tasks_op_track_time");
    recorded.results.tasks = [
      { data: { time_spent_seconds: 100 }, error: null },
      { data: { time_spent_seconds: 1800 }, error: null },
      { data: { time_spent_seconds: 1000 }, error: null },
      { data: { time_spent_seconds: 100 }, error: null },
      { data: null, error: null },
    ];
    const typed = await webRuntime.tasks.trackTime({
      workspaceId: "w1",
      taskId: "t1",
      action: "set_total",
      seconds: 1800,
    });
    expect(typed).toMatchObject({ status: "saved", totalSeconds: 1800 });
    expect(recorded.queries[1]?.calls.find(([m]) => m === "update")?.[1]).toEqual([
      { time_spent_seconds: 1800 },
    ]);
    const undone = await webRuntime.tasks.trackTime({
      workspaceId: "w1",
      taskId: "t1",
      action: "undo",
      entryId: null,
      seconds: 900,
    });
    expect(undone).toMatchObject({ status: "saved", totalSeconds: 100 });
    expect(recorded.queries[3]?.calls.find(([m]) => m === "update")?.[1]).toEqual([
      { time_spent_seconds: 100 },
    ]);
    const gone = await webRuntime.tasks.trackTime({
      workspaceId: "w1",
      taskId: "nope",
      action: "focus",
      seconds: 60,
    });
    expect(gone).toMatchObject({ status: "gone", totalSeconds: null });
  });

  it("any other error is thrown, not hidden behind the fallback", async () => {
    recorded.rpcResults.tasks_op_track_time = {
      data: null,
      error: { code: "42501", message: "You don't have access to this task." },
    };
    await expect(
      webRuntime.tasks.trackTime({ workspaceId: "w1", taskId: "t1", action: "focus", seconds: 5 }),
    ).rejects.toThrow("You don't have access to this task.");
    expect(recorded.queries).toHaveLength(0);
  });
});

describe("listTimeTotals (TV-D3)", () => {
  it("maps each task's total and the caller's share", async () => {
    recorded.rpcResults.tasks_time_totals = {
      data: [
        {
          task_id: "t1",
          total_seconds: 270,
          my_seconds: 150,
          my_waiting_seconds: 0,
          my_seconds_since: 90,
        },
      ],
      error: null,
    };
    await expect(webRuntime.tasks.listTimeTotals("w1", "2026-10-05T00:00:00Z")).resolves.toEqual([
      { taskId: "t1", totalSeconds: 270, mySeconds: 150, myWaitingSeconds: 0, mySecondsSince: 90 },
    ]);
    expect(recorded.rpcs[0]?.args).toEqual({
      p_workspace_id: "w1",
      p_since: "2026-10-05T00:00:00Z",
    });
  });

  it("is empty until the migration reaches the database", async () => {
    recorded.rpcResults.tasks_time_totals = MISSING("tasks_time_totals");
    await expect(webRuntime.tasks.listTimeTotals("w1")).resolves.toEqual([]);
  });
});
