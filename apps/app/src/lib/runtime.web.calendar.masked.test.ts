// CALR-15 (specs/calendar-rethink.md AC28): the app reads the week through the
// masked read, calendar_events_visible, so a teammate's private event arrives
// as "Busy" and never with its title. The raw table is left to the live
// channel, whose SELECT policy drops teammates' private rows.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { webCalendar } from "./runtime.web.calendar";

type Call = { kind: "from" | "rpc"; name: string; args?: unknown; chain: string[] };

const h = rs.hoisted(() => ({
  calls: [] as Call[],
  rows: {} as Record<string, unknown[]>,
}));

/** A PostgREST builder that takes any chain and answers with the named rows. */
function builder(call: Call) {
  const rows = () => h.rows[call.name] ?? [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            const head = call.chain.includes("head");
            const data = rows();
            return Promise.resolve({
              data: head ? null : data,
              error: null,
              count: data.length,
            }).then(resolve, reject);
          };
        }
        return (...args: unknown[]) => {
          call.chain.push(prop);
          const opts = args[1] as { head?: boolean } | undefined;
          if (opts && typeof opts === "object" && opts.head) call.chain.push("head");
          return proxy;
        };
      },
    },
  );
  return proxy;
}

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    from: (name: string) => {
      const call: Call = { kind: "from", name, chain: [] };
      h.calls.push(call);
      return builder(call);
    },
    rpc: (name: string, args: unknown, opts?: { head?: boolean }) => {
      const call: Call = { kind: "rpc", name, args, chain: opts?.head ? ["head"] : [] };
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

beforeEach(() => {
  h.calls.length = 0;
  h.rows = {
    calendar_events_visible: [
      {
        ...ROW,
        id: "mine",
        owner_id: "me",
        calendar_ref: "cal-me",
        title: "Investor prep",
        start_time: "2026-11-03T10:00:00Z",
        end_time: "2026-11-03T11:00:00Z",
        is_private: false,
      },
      {
        ...ROW,
        id: "kais",
        owner_id: "kai",
        calendar_ref: "cal-kai",
        title: "Busy",
        start_time: "2026-11-03T17:00:00Z",
        end_time: "2026-11-03T18:00:00Z",
        is_private: true,
      },
    ],
    calendar_accounts: [],
  };
});

const WINDOW = { fromIso: "2026-11-02T00:00:00.000Z", toIso: "2026-11-09T00:00:00.000Z" };

describe("webCalendar.listModule reads the masked week (CALR-15)", () => {
  it("asks calendar_events_visible for the workspace and the window", async () => {
    await webCalendar.listModule("w", WINDOW);
    const reads = h.calls.filter((c) => c.kind === "rpc" && c.name === "calendar_events_visible");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.args).toEqual({
        p_workspace_id: "w",
        p_from: WINDOW.fromIso,
        p_to: WINDOW.toIso,
      });
    }
  });

  it("never reads events from the raw table", async () => {
    await webCalendar.listModule("w", WINDOW);
    expect(h.calls.some((c) => c.kind === "from" && c.name === "calendar_events")).toBe(false);
  });

  it("hands back a teammate's private event as the masked read gave it", async () => {
    const result = await webCalendar.listModule("w", WINDOW);
    expect(result.degraded).toBe(false);
    const byId = new Map(result.events.map((e) => [e.id, e]));
    expect(byId.get("mine")?.title).toBe("Investor prep");
    expect(byId.get("kais")?.title).toBe("Busy");
    expect(byId.get("kais")?.isPrivate).toBe(true);
    expect(byId.get("kais")?.ownerId).toBe("kai");
  });

  it("still reads the accounts", async () => {
    await webCalendar.listModule("w", WINDOW);
    expect(h.calls.some((c) => c.kind === "from" && c.name === "calendar_accounts")).toBe(true);
  });
});
