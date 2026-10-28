// How booking availability reads the host's events: through the server's
// calendar__booking_host_events, which expands repeats over the booking
// window (a weekly 1:1 that began weeks ago blocks this week), for the host
// and workspace only, and never as "no busy time" when the read fails, the
// function is missing included (migration not applied yet).

import { describe, expect, it } from "@rstest/core";

import { busyFromHostEvents, HOST_EVENTS_FN, HOST_EVENTS_PAGE, readHostEvents } from "./booking-busy.ts";

type Answer = { data: unknown; error: { code?: string; message: string } | null };

function fake(answers: Answer[]) {
  const asked: { fn: string; args: Record<string, unknown> }[] = [];
  const pages: { from: number; to: number }[] = [];
  return {
    asked,
    pages,
    rpc: (fn: string, args: Record<string, unknown>, rows: { from: number; to: number }) => {
      asked.push({ fn, args });
      pages.push(rows);
      return Promise.resolve(answers.shift() ?? { data: [], error: null });
    },
  };
}

const WINDOW = {
  workspaceId: "ws-1",
  hostId: "host-1",
  from: new Date("2026-10-28T06:00:00.000Z"),
  to: new Date("2026-11-27T06:00:00.000Z"),
  zone: "Europe/Warsaw",
};

// What the server answers for a weekly 1:1 (three occurrences in the window,
// the second moved) and weekly focus time.
const rows = [
  { start_time: "2026-10-28T08:00:00+00:00", end_time: "2026-10-28T08:30:00+00:00", source_account_id: null, calendar_id: "moduo", kind: "event" },
  { start_time: "2026-11-02T12:00:00+00:00", end_time: "2026-11-02T14:00:00+00:00", source_account_id: null, calendar_id: "moduo", kind: "focus" },
  { start_time: "2026-11-11T14:00:00+00:00", end_time: "2026-11-11T14:30:00+00:00", source_account_id: null, calendar_id: "moduo", kind: "event" },
  { start_time: "2026-11-18T08:00:00+00:00", end_time: "2026-11-18T08:30:00+00:00", source_account_id: null, calendar_id: "moduo", kind: "event" },
];

describe("readHostEvents", () => {
  it("asks the server for the host's expanded busy rows in the window and hands them on", async () => {
    const db = fake([{ data: rows, error: null }]);
    expect(await readHostEvents(db.rpc, WINDOW)).toEqual(rows);
    expect(HOST_EVENTS_FN).toBe("calendar__booking_host_events");
    expect(db.asked).toEqual([
      {
        fn: "calendar__booking_host_events",
        args: {
          p_workspace_id: "ws-1",
          p_owner_id: "host-1",
          p_from: "2026-10-28T06:00:00.000Z",
          p_to: "2026-11-27T06:00:00.000Z",
          p_zone: "Europe/Warsaw",
        },
      },
    ]);
  });

  it("falls back to UTC only when the link names no zone", async () => {
    const db = fake([{ data: [], error: null }]);
    await readHostEvents(db.rpc, { ...WINDOW, zone: "" });
    expect(db.asked[0]?.args.p_zone).toBe("UTC");
  });

  it("the rows it hands on feed the kind filter: focus only when ticked", async () => {
    const db = fake([{ data: rows, error: null }]);
    const read = await readHostEvents(db.rpc, WINDOW);
    expect(busyFromHostEvents(read, ["moduo"]).map((i) => i.start.toISOString())).toEqual([
      "2026-10-28T08:00:00.000Z",
      "2026-11-11T14:00:00.000Z",
      "2026-11-18T08:00:00.000Z",
    ]);
    expect(busyFromHostEvents(read, ["moduo", "focus"])).toHaveLength(4);
  });

  it("throws on a failed read instead of offering busy time as free", async () => {
    const db = fake([{ data: null, error: { code: "57014", message: "statement timeout" } }]);
    await expect(readHostEvents(db.rpc, WINDOW)).rejects.toThrow("host events: statement timeout");
    expect(db.asked).toHaveLength(1);
  });

  it("throws when the function isn't there yet, never reading the unexpanded table", async () => {
    const db = fake([
      { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      { data: [], error: null },
    ]);
    await expect(readHostEvents(db.rpc, WINDOW)).rejects.toThrow("host events: Could not find the function");
    expect(db.asked).toHaveLength(1);
  });

  it("pages past PostgREST's row cap instead of offering the rest as free", async () => {
    const full = Array.from({ length: HOST_EVENTS_PAGE }, () => rows[0]);
    const db = fake([
      { data: full, error: null },
      { data: full, error: null },
      { data: [rows[3]], error: null },
    ]);
    const read = await readHostEvents(db.rpc, WINDOW);
    expect(read).toHaveLength(2 * HOST_EVENTS_PAGE + 1);
    expect(db.pages).toEqual([
      { from: 0, to: HOST_EVENTS_PAGE - 1 },
      { from: HOST_EVENTS_PAGE, to: 2 * HOST_EVENTS_PAGE - 1 },
      { from: 2 * HOST_EVENTS_PAGE, to: 3 * HOST_EVENTS_PAGE - 1 },
    ]);
  });

  it("gives up rather than read without end", async () => {
    const full = Array.from({ length: HOST_EVENTS_PAGE }, () => rows[0]);
    const db = fake(Array.from({ length: 30 }, () => ({ data: full, error: null })));
    await expect(readHostEvents(db.rpc, WINDOW)).rejects.toThrow("host events: more than");
  });

  it("refuses a link without a workspace (it would match nothing: all free)", async () => {
    const db = fake([]);
    await expect(readHostEvents(db.rpc, { ...WINDOW, workspaceId: null })).rejects.toThrow("host events");
    expect(db.asked).toHaveLength(0);
  });

  it("throws on an answer that isn't a list", async () => {
    const db = fake([{ data: { start_time: "x" }, error: null }]);
    await expect(readHostEvents(db.rpc, WINDOW)).rejects.toThrow("host events");
  });
});
