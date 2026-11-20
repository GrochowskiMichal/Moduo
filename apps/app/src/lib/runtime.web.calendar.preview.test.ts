// CALR-16 (specs/calendar-rethink.md AC29, AC30): Preview as reads the real
// masked read for the teammate (p_as), never a client-side copy of the rules;
// Shared with you reads calendar_shared_with_me. The normal week never sends
// p_as (the app sends a new RPC argument only when it is set).

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { webCalendar } from "./runtime.web.calendar";

type Call = { kind: "from" | "rpc"; name: string; args?: unknown };

const h = rs.hoisted(() => ({
  calls: [] as Call[],
  rows: {} as Record<string, unknown[] | { error: unknown }>,
}));

/** A PostgREST builder that takes any chain and answers with the named rows. */
function builder(call: Call) {
  const answer = () => {
    const v = h.rows[call.name];
    if (v && !Array.isArray(v)) return { data: null, error: v.error, count: null };
    const data = v ?? [];
    return { data, error: null, count: data.length };
  };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(answer()).then(resolve, reject);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    from: (name: string) => {
      const call: Call = { kind: "from", name };
      h.calls.push(call);
      return builder(call);
    },
    rpc: (name: string, args: unknown) => {
      const call: Call = { kind: "rpc", name, args };
      h.calls.push(call);
      return builder(call);
    },
  },
}));

const ROW = {
  workspace_id: "w",
  source_account_id: null,
  external_event_id: null,
  calendar_id: "moduo",
  description: null,
  all_day: false,
  recurrence_rule: null,
  status: "confirmed",
  location: null,
  color: null,
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
  deleted_at: null,
  attendees: [],
};
const WINDOW = { fromIso: "2026-11-02T00:00:00.000Z", toIso: "2026-11-09T00:00:00.000Z" };

beforeEach(() => {
  h.calls.length = 0;
  h.rows = {
    calendar_events_visible: [
      {
        ...ROW,
        id: "therapy",
        owner_id: "me",
        calendar_ref: "cal-work",
        title: "Busy",
        start_time: "2026-11-03T17:00:00Z",
        end_time: "2026-11-03T18:00:00Z",
        is_private: true,
      },
    ],
    calendar_busy_blocks: [
      {
        calendar_id: "cal-family",
        owner_id: "me",
        start_time: "2026-11-03T08:00:00Z",
        end_time: "2026-11-03T08:30:00Z",
        kind: "event",
        all_day: false,
      },
    ],
    calendar_preview_levels: [
      { calendar_id: "cal-work", level: "view" },
      { calendar_id: "cal-family", level: "freebusy" },
      { calendar_id: "cal-holidays", level: "none" },
      { calendar_id: "cal-odd", level: "owner" },
    ],
    calendar_shared_with_me: [
      { calendar_id: "cal-kai", owner_id: "kai", level: "view" },
      { calendar_id: "cal-nora", owner_id: "nora", level: "freebusy" },
      { calendar_id: "cal-odd", owner_id: "x", level: "everything" },
    ],
    calendar_accounts: [],
  };
});

describe("Preview as reads the masked read for the teammate", () => {
  it("asks the masked read, busy blocks and levels with p_as", async () => {
    await webCalendar.preview!({ workspaceId: "w", as: "kai", window: WINDOW });
    const by = (name: string) => h.calls.filter((c) => c.kind === "rpc" && c.name === name);
    expect(by("calendar_events_visible").map((c) => c.args)).toEqual([
      { p_workspace_id: "w", p_from: WINDOW.fromIso, p_to: WINDOW.toIso, p_as: "kai" },
    ]);
    expect(by("calendar_busy_blocks").map((c) => c.args)).toEqual([
      { p_workspace_id: "w", p_from: WINDOW.fromIso, p_to: WINDOW.toIso, p_as: "kai" },
    ]);
    expect(by("calendar_preview_levels").map((c) => c.args)).toEqual([
      { p_workspace_id: "w", p_as: "kai" },
    ]);
    expect(h.calls.some((c) => c.kind === "from" && c.name === "calendar_events")).toBe(false);
  });

  it("hands back the rows as the server masked them, the blocks as busy events, and known levels", async () => {
    const out = await webCalendar.preview!({ workspaceId: "w", as: "kai", window: WINDOW });
    expect(out.failed).toBe(false);
    expect(out.rows.map((e) => [e.id, e.title, e.isPrivate])).toEqual([["therapy", "Busy", true]]);
    expect(out.busy).toHaveLength(1);
    expect(out.busy[0].id.startsWith("busy:")).toBe(true);
    expect(out.busy[0].calendarRef).toBe("cal-family");
    expect(out.busy[0].ownerId).toBe("me");
    expect(out.levels).toEqual([
      { calendarId: "cal-work", level: "view" },
      { calendarId: "cal-family", level: "freebusy" },
      { calendarId: "cal-holidays", level: "none" },
    ]);
  });

  it("a failed read is a failed preview, never an empty week that reads as “Nothing”", async () => {
    h.rows.calendar_events_visible = { error: { message: "boom" } };
    const out = await webCalendar.preview!({ workspaceId: "w", as: "kai", window: WINDOW });
    expect(out.failed).toBe(true);
  });

  it("the normal week never sends p_as", async () => {
    await webCalendar.listModule("w", WINDOW);
    const reads = h.calls.filter((c) => c.kind === "rpc" && c.name === "calendar_events_visible");
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(Object.keys(r.args as object)).not.toContain("p_as");
  });
});

describe("Shared with you", () => {
  it("reads calendar_shared_with_me for the workspace and keeps the known levels", async () => {
    const shared = await webCalendar.sharedWithMe!("w");
    const call = h.calls.find((c) => c.kind === "rpc" && c.name === "calendar_shared_with_me");
    expect(call?.args).toEqual({ p_workspace_id: "w" });
    expect(shared).toEqual([
      { calendarId: "cal-kai", ownerId: "kai", level: "view" },
      { calendarId: "cal-nora", ownerId: "nora", level: "freebusy" },
    ]);
  });

  it("answers an empty list when the read fails (before the migration lands)", async () => {
    h.rows.calendar_shared_with_me = { error: { message: "function does not exist" } };
    expect(await webCalendar.sharedWithMe!("w")).toEqual([]);
  });
});
