import { describe, expect, it, rs } from "@rstest/core";

import { TASKS_BUSY_ID as APP_TASKS_BUSY_ID } from "../../../src/features/calendar/booking/model.ts";
import { BUSY_SESSIONS_RPC, sessionBusyIntervals, TASKS_BUSY_ID } from "./booking-sessions.ts";

/** A Supabase client stand-in: records the rpc calls, answers with `answer`. */
function fakeDb(answer: { data: unknown; error: unknown }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    db: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push([fn, args]);
        return Promise.resolve(answer);
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

describe("sessionBusyIntervals (TV-D10 default d, TV-D10-fix)", () => {
  it("asks the server's task gate for the host's busy times in the window, nothing else", async () => {
    const { db, calls } = fakeDb({ data: [], error: null });
    await sessionBusyIntervals(db, range);
    expect(calls).toEqual([
      [
        "tasks__busy_sessions",
        {
          p_workspace_id: "ws-1",
          p_user_id: "host-1",
          p_from: "2030-03-04T00:00:00.000Z",
          p_to: "2030-03-18T00:00:00.000Z",
        },
      ],
    ]);
    expect(BUSY_SESSIONS_RPC).toBe("tasks__busy_sessions");
  });

  it("turns the answer into busy times, and only times", async () => {
    const { db } = fakeDb({
      error: null,
      data: [
        { starts_at: "2030-03-05T09:00:00Z", ends_at: "2030-03-05T10:30:00Z" },
        { starts_at: "2030-03-06T09:00:00Z", ends_at: "2030-03-06T09:00:00Z" },
        { starts_at: "not a time", ends_at: "2030-03-07T10:00:00Z" },
      ],
    });
    const busy = await sessionBusyIntervals(db, range);
    expect(busy).toEqual([
      { start: new Date("2030-03-05T09:00:00Z"), end: new Date("2030-03-05T10:30:00Z") },
    ]);
    // Nothing but the times leaves the function.
    expect(Object.keys(busy[0]!).sort()).toEqual(["end", "start"]);
  });

  it("keeps its busy-list id in step with the app", () => {
    expect(TASKS_BUSY_ID).toBe(APP_TASKS_BUSY_ID);
  });

  it("blocks nothing when the read fails (a database before the busy function)", async () => {
    const quiet = rs.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.tasks__busy_sessions" },
    });
    expect(await sessionBusyIntervals(db, range)).toEqual([]);
    quiet.mockRestore();
  });
});
