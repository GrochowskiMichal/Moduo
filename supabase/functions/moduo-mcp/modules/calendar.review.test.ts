/**
 * CALR-21 review fixes on the calendar tools' reads: only a missing
 * occurrences function falls back (any other failure is an error, never a
 * quiet list of first occurrences); a repeat's item keeps the series' own
 * first times beside the occurrence's, since its id is the whole series; a
 * teammate's private item never says whether it is focus time or a hold.
 */

import { describe, expect, it, rs } from "@rstest/core";

rs.mock("../share.ts", () => ({ assertReach: async () => {}, visibleIds: async () => new Set<string>() }));

import type { ToolContext } from "../registry.ts";
import { calendarConnectorModule } from "./calendar.ts";

type Row = Record<string, any>;
const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";

function ctxWith(answers: Record<string, { data?: Row[]; error?: Row }>): ToolContext {
  const rpc = (fn: string) => {
    const b: any = {
      order: () => b,
      range: () => b,
      then: (resolve: (r: unknown) => unknown) =>
        Promise.resolve({ data: answers[fn]?.data ?? null, error: answers[fn]?.error ?? null }).then(resolve),
    };
    return b;
  };
  return {
    key: { id: "k", workspaceId: WS, name: "Planner", createdBy: ME, scopes: { calendar: "view" } },
    db: { rpc } as unknown as ToolContext["db"],
  } as ToolContext;
}

const list = calendarConnectorModule.tools.find((t) => t.name === "calendar_list_events")!;
const window = { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" };
const row = (over: Row): Row => ({
  workspace_id: WS,
  owner_id: ME,
  title: "Event",
  start_time: "2026-11-04T10:00:00.000Z",
  end_time: "2026-11-04T11:00:00.000Z",
  all_day: false,
  recurrence_rule: null,
  calendar_id: "moduo",
  source_account_id: null,
  attendees: [],
  is_private: false,
  kind: "event",
  ...over,
});

describe("calendar reads after review", () => {
  it("a failing occurrences read is an error, not a quiet fallback", async () => {
    const ctx = ctxWith({
      calendar_events_visible: { data: [row({ id: "e1" })] },
      calendar_event_occurrences: { error: { message: "canceling statement due to statement timeout", code: "57014" } },
    });
    await expect(list.handler(window, ctx)).rejects.toThrow(/statement timeout/);
  });

  it("an error without a code is an error too", async () => {
    const ctx = ctxWith({
      calendar_events_visible: { data: [row({ id: "e1" })] },
      calendar_event_occurrences: { error: { message: "<html>502 Bad Gateway</html>" } },
    });
    await expect(list.handler(window, ctx)).rejects.toThrow(/502/);
  });

  it("a repeat's occurrence carries the series' own first times", async () => {
    const weekly = row({
      id: "w",
      recurrence_rule: "FREQ=WEEKLY",
      start_time: "2026-10-06T09:00:00.000Z",
      end_time: "2026-10-06T09:30:00.000Z",
    });
    const ctx = ctxWith({
      calendar_events_visible: { data: [weekly] },
      calendar_event_occurrences: {
        data: [{ event_id: "w", starts_at: "2026-11-03T10:00:00.000Z", ends_at: "2026-11-03T10:30:00.000Z" }],
      },
    });
    const [item] = (await list.handler(window, ctx)) as Row[];
    expect(item).toMatchObject({
      id: "w",
      starts_at: "2026-11-03T10:00:00.000Z",
      series_starts_at: "2026-10-06T09:00:00.000Z",
      series_ends_at: "2026-10-06T09:30:00.000Z",
    });
  });

  it("a one-off has no series times", async () => {
    const e = row({ id: "one" });
    const ctx = ctxWith({
      calendar_events_visible: { data: [e] },
      calendar_event_occurrences: { data: [{ event_id: "one", starts_at: e.start_time, ends_at: e.end_time }] },
    });
    const [item] = (await list.handler(window, ctx)) as Row[];
    expect(item).not.toHaveProperty("series_starts_at");
  });

  it("a teammate's private focus time reads as a plain Busy event; your own keeps its kind", async () => {
    const theirs = row({ id: "t", owner_id: "kai", title: "Busy", is_private: true, kind: "focus" });
    const mine = row({ id: "m", title: "Deep work", is_private: true, kind: "focus", start_time: "2026-11-05T08:00:00.000Z", end_time: "2026-11-05T09:00:00.000Z" });
    const ctx = ctxWith({
      calendar_events_visible: { data: [theirs, mine] },
      calendar_event_occurrences: {
        data: [theirs, mine].map((e) => ({ event_id: e.id, starts_at: e.start_time, ends_at: e.end_time })),
      },
    });
    const out = (await list.handler(window, ctx)) as Row[];
    expect(out.find((e) => e.id === "t")).toMatchObject({ title: "Busy", kind: "event", private: true });
    expect(out.find((e) => e.id === "t")).not.toHaveProperty("focus_task_id");
    expect(out.find((e) => e.id === "m")?.kind).toBe("focus");
  });
});
