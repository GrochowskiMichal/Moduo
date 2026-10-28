// The web runtime's read for the Event view (CALR-10): the calendar row, its
// sharing through share_op_state, and the booking link the event came through.
// Each part is null when it can't be read, and nothing is read without a
// calendar to read it for.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { webCalendar } from "./runtime.web.calendar";

type Reply = { data: unknown; error: { message: string } | null };

const h = rs.hoisted(() => ({
  tables: {} as Record<string, Reply>,
  rpc: { data: null, error: null } as Reply,
  reads: [] as { table: string; filters: [string, unknown][] }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
}));

rs.mock("./runtime.web.client", () => {
  const query = (table: string) => {
    const read = { table, filters: [] as [string, unknown][] };
    h.reads.push(read);
    const chain = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        read.filters.push([col, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(h.tables[table] ?? { data: null, error: null }),
    };
    return chain;
  };
  return {
    supabaseClient: {
      from: query,
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcs.push({ fn, args });
        return Promise.resolve(h.rpc);
      },
    },
  };
});

beforeEach(() => {
  h.tables = {};
  h.rpc = { data: null, error: null };
  h.reads.length = 0;
  h.rpcs.length = 0;
});

describe("webCalendar.eventContext (CALR-10)", () => {
  it("reads the calendar, its sharing and the booking link", async () => {
    h.tables.calendars = { data: { name: "Moduo", kind: "moduo", owner_id: "u-me" }, error: null };
    h.tables.slot_bookings = {
      data: { slot_id: "slot-1", created_at: "2026-10-24T09:00:00Z" },
      error: null,
    };
    h.tables.exposed_slot_links = { data: { name: "30-minute intro" }, error: null };
    h.rpc = {
      data: {
        visible: true,
        workspaceLevel: "freebusy",
        people: [{ userId: "u-kai", level: "view" }],
      },
      error: null,
    };

    const read = await webCalendar.eventContext({ eventId: "ev-1", calendarRef: "cal-1" });

    expect(read).toEqual({
      calendar: { name: "Moduo", kind: "moduo", ownerId: "u-me" },
      share: { workspaceLevel: "freebusy", people: [{ userId: "u-kai", level: "view" }] },
      booking: { linkName: "30-minute intro", bookedAt: "2026-10-24T09:00:00Z" },
    });
    expect(h.rpcs).toEqual([{ fn: "share_op_state", args: { p_type: "calendar", p_id: "cal-1" } }]);
    expect(h.reads.find((r) => r.table === "slot_bookings")?.filters).toContainEqual([
      "calendar_event_id",
      "ev-1",
    ]);
    expect(h.reads.find((r) => r.table === "exposed_slot_links")?.filters).toContainEqual([
      "slot_id",
      "slot-1",
    ]);
  });

  it("is null part by part when a read fails or isn't visible", async () => {
    h.tables.calendars = { data: null, error: { message: "denied" } };
    h.rpc = { data: { visible: false }, error: null };
    const read = await webCalendar.eventContext({ eventId: "ev-1", calendarRef: "cal-1" });
    expect(read).toEqual({ calendar: null, share: null, booking: null });
  });

  it("reads no calendar or sharing for an event with no calendar row", async () => {
    const read = await webCalendar.eventContext({ eventId: "ev-1", calendarRef: null });
    expect(read).toEqual({ calendar: null, share: null, booking: null });
    expect(h.rpcs).toEqual([]);
    expect(h.reads.map((r) => r.table)).toEqual(["slot_bookings"]);
  });
});
