/**
 * CALR-21, AC46 "calendar tools": assistants can, through MCP, create an
 * event with a place, link or privacy, offer times and read who sees what;
 * every change goes through an op on the key's client (so it is the key's).
 *
 * Reads go through the masked read (calendar_events_visible, three arguments:
 * never p_as) plus calendar_event_occurrences for each occurrence in the
 * window, both page by page (PostgREST stops at 1,000 rows a request). A
 * connector deployed before the occurrences read falls back to the one-offs.
 * New op arguments are sent only when the caller set them.
 *
 * The database is an in-memory stand-in that records every call.
 */

import { describe, expect, it, rs } from "@rstest/core";

rs.mock("../share.ts", () => ({
  assertReach: async () => {},
  visibleIds: async () => new Set<string>(),
}));

import type { ToolContext } from "../registry.ts";
import { calendarConnectorModule } from "./calendar.ts";

type Row = Record<string, any>;

const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const KAI = "33333333-3333-4333-8333-333333333333";
const NORA = "44444444-4444-4444-8444-444444444444";
const WORK = "55555555-5555-4555-8555-555555555555";
const LINK = "66666666-6666-4666-8666-666666666666";
const OFFER = "77777777-7777-4777-8777-777777777777";

type RpcCall = { fn: string; args: Row; range: [number, number] | null };

type Fake = {
  rpcRows?: Record<string, Row[] | { error: { message: string; code?: string } }>;
  rpcResult?: Record<string, unknown>;
  tables?: Record<string, Row[]>;
};

function fakeDb(fake: Fake) {
  const rpcCalls: RpcCall[] = [];
  const tableCalls: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];

  function rpc(fn: string, args: Row) {
    const call: RpcCall = { fn, args, range: null };
    rpcCalls.push(call);
    const builder: any = {
      range: (from: number, to: number) => ((call.range = [from, to]), builder),
      order: () => builder,
      then<T>(resolve: (res: { data: unknown; error: unknown }) => T) {
        const set = fake.rpcRows?.[fn];
        if (set && !Array.isArray(set)) return Promise.resolve({ data: null, error: set.error }).then(resolve);
        if (set) {
          // A set-returning read: PostgREST's 1,000-row cap applies to every request.
          const [from, to] = call.range ?? [0, set.length - 1];
          const page = set.slice(from, Math.min(to + 1, from + 1000));
          return Promise.resolve({ data: page, error: null }).then(resolve);
        }
        return Promise.resolve({ data: fake.rpcResult?.[fn] ?? null, error: null }).then(resolve);
      },
    };
    return builder;
  }

  function from(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    tableCalls.push({ table, filters });
    let max = Number.POSITIVE_INFINITY;
    const keep = (r: Row) =>
      filters.every(([op, c, v]) => {
        if (op === "eq") return r[c] === v;
        if (op === "is") return (r[c] ?? null) === v;
        if (op === "in") return (v as unknown[]).includes(r[c]);
        if (op === "gte") return String(r[c]) >= String(v);
        if (op === "lt") return String(r[c]) < String(v);
        return true;
      });
    const query: any = {
      select: () => query,
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), query),
      is: (c: string, v: unknown) => (filters.push(["is", c, v]), query),
      in: (c: string, v: unknown) => (filters.push(["in", c, v]), query),
      gte: (c: string, v: unknown) => (filters.push(["gte", c, v]), query),
      lt: (c: string, v: unknown) => (filters.push(["lt", c, v]), query),
      order: () => query,
      range: () => query,
      limit: (n: number) => ((max = n), query),
      then<T>(resolve: (res: { data: Row[]; error: null }) => T) {
        const data = (fake.tables?.[table] ?? []).filter(keep).slice(0, max);
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  }

  const ctx = {
    key: {
      id: "key-1",
      workspaceId: WS,
      name: "Planner",
      createdBy: ME,
      scopes: { calendar: "edit", tasks: "none" },
    },
    db: { rpc, from } as unknown as ToolContext["db"],
  } as ToolContext;
  return { ctx, rpcCalls, tableCalls };
}

function tool(name: string) {
  const found = calendarConnectorModule.tools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

/** A calendar_events row as the masked read returns it. */
function eventRow(over: Row): Row {
  return {
    id: over.id ?? crypto.randomUUID(),
    workspace_id: WS,
    owner_id: ME,
    title: "Event",
    description: "",
    start_time: "2026-11-04T10:00:00.000Z",
    end_time: "2026-11-04T11:00:00.000Z",
    all_day: false,
    recurrence_rule: null,
    status: "confirmed",
    calendar_id: "moduo",
    calendar_ref: WORK,
    source_account_id: null,
    location: null,
    conference_url: null,
    conference_provider: null,
    attendees: [],
    is_private: false,
    kind: "event",
    focus_task_id: null,
    offer_id: null,
    series_id: null,
    original_start: null,
    exdates: [],
    ...over,
  };
}

const occ = (event: Row, starts_at = event.start_time, ends_at = event.end_time) => ({
  event_id: event.id,
  starts_at,
  ends_at,
});

describe("calendar tools · reading the week", () => {
  const board = eventRow({
    id: "e-board",
    title: "Board review",
    location: "Hale office, 12 Rua Augusta",
    conference_url: "https://meet.google.com/abc-defg-hij",
    conference_provider: "google_meet",
    attendees: [{ email: "priya@example.com", name: "Priya", status: "accepted" }],
  });
  const weekly = eventRow({
    id: "e-weekly",
    title: "1:1 with Priya",
    start_time: "2026-10-06T09:00:00.000Z",
    end_time: "2026-10-06T09:30:00.000Z",
    recurrence_rule: "FREQ=WEEKLY",
  });
  // A teammate's private event, as the masked read hands it over.
  const busy = eventRow({
    id: "e-busy",
    owner_id: KAI,
    title: "Busy",
    is_private: true,
    start_time: "2026-11-03T17:00:00.000Z",
    end_time: "2026-11-03T18:00:00.000Z",
  });
  const hold = eventRow({
    id: "e-hold",
    title: "Held · Intro call",
    kind: "hold",
    offer_id: OFFER,
    start_time: "2026-11-05T09:00:00.000Z",
    end_time: "2026-11-05T09:30:00.000Z",
  });

  it("reads through the masked read with three arguments, never p_as", async () => {
    const { ctx, rpcCalls } = fakeDb({
      rpcRows: { calendar_events_visible: [board], calendar_event_occurrences: [occ(board)] },
    });
    await tool("calendar_list_events").handler({ from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" }, ctx);
    const visible = rpcCalls.filter((c) => c.fn === "calendar_events_visible");
    expect(visible.length).toBeGreaterThan(0);
    for (const c of visible) {
      expect(Object.keys(c.args).sort()).toEqual(["p_from", "p_to", "p_workspace_id"]);
      expect(c.args.p_workspace_id).toBe(WS);
    }
  });

  it("lists every occurrence in the window: a series from October shows on its November dates", async () => {
    const { ctx } = fakeDb({
      rpcRows: {
        calendar_events_visible: [weekly, board],
        calendar_event_occurrences: [
          occ(weekly, "2026-11-03T10:00:00.000Z", "2026-11-03T10:30:00.000Z"),
          occ(board),
        ],
      },
    });
    const out = (await tool("calendar_list_events").handler(
      { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" },
      ctx,
    )) as Row[];
    expect(out.map((e) => [e.id, e.starts_at])).toEqual([
      ["e-weekly", "2026-11-03T10:00:00.000Z"],
      ["e-board", "2026-11-04T10:00:00.000Z"],
    ]);
    expect(out[0]!.ends_at).toBe("2026-11-03T10:30:00.000Z");
    expect(out[0]!.recurrence).toBe("FREQ=WEEKLY");
  });

  it("shows the new fields: kind, place, link, people, privacy, whose it is, the offer a hold is for", async () => {
    const { ctx } = fakeDb({
      rpcRows: {
        calendar_events_visible: [board, busy, hold],
        calendar_event_occurrences: [occ(busy), occ(board), occ(hold)],
      },
    });
    const out = (await tool("calendar_list_events").handler(
      { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" },
      ctx,
    )) as Row[];
    const byId = new Map(out.map((e) => [e.id, e]));
    const b = byId.get("e-board")!;
    expect(b.kind).toBe("event");
    expect(b.place).toBe("Hale office, 12 Rua Augusta");
    expect(b.link).toEqual({ url: "https://meet.google.com/abc-defg-hij", provider: "google_meet" });
    expect(b.people).toEqual([{ email: "priya@example.com", name: "Priya", status: "accepted" }]);
    expect(b.private).toBe(false);
    expect(b.mine).toBe(true);
    expect(b.calendar_ref).toBe(WORK);

    // A teammate's private event says Busy and nothing else.
    const k = byId.get("e-busy")!;
    expect(k.title).toBe("Busy");
    expect(k.private).toBe(true);
    expect(k.mine).toBe(false);
    expect(k.owner_id).toBe(KAI);
    expect(k.place).toBeNull();
    expect(k.link).toBeNull();
    expect(k.people).toEqual([]);

    const h = byId.get("e-hold")!;
    expect(h.kind).toBe("hold");
    expect(h.offer_id).toBe(OFFER);
  });

  it("never sends Google's iCalUID or organizer flag", async () => {
    const google = eventRow({ id: "e-g", ical_uid: "abc@google.com", is_organizer: true, source_account_id: "acc" });
    const { ctx } = fakeDb({
      rpcRows: { calendar_events_visible: [google], calendar_event_occurrences: [occ(google)] },
    });
    const [e] = (await tool("calendar_list_events").handler(
      { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" },
      ctx,
    )) as Row[];
    expect(e!.external).toBe(true);
    expect(JSON.stringify(e)).not.toContain("abc@google.com");
    expect(e).not.toHaveProperty("ical_uid");
    expect(e).not.toHaveProperty("is_organizer");
  });

  it("reads past PostgREST's 1,000 rows, page by page", async () => {
    const many = Array.from({ length: 1500 }, (_, i) =>
      eventRow({
        id: `e-${i}`,
        title: `Event ${i}`,
        start_time: new Date(Date.UTC(2026, 10, 4, 12) + i * 60_000).toISOString(),
        end_time: new Date(Date.UTC(2026, 10, 4, 12) + i * 60_000 + 30 * 60_000).toISOString(),
      }),
    );
    // The earliest occurrence belongs to the 1,400th row of the events read.
    const early = eventRow({
      id: "e-early",
      title: "Breakfast",
      start_time: "2026-11-02T07:00:00.000Z",
      end_time: "2026-11-02T08:00:00.000Z",
    });
    const events = [...many.slice(0, 1400), early, ...many.slice(1400)];
    const { ctx, rpcCalls } = fakeDb({
      rpcRows: {
        calendar_events_visible: events,
        calendar_event_occurrences: [...many.map((e) => occ(e)), occ(early)],
      },
    });
    const out = (await tool("calendar_list_events").handler(
      { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z", limit: 10 },
      ctx,
    )) as Row[];
    expect(out[0]!.id).toBe("e-early");
    expect(out).toHaveLength(10);
    expect(rpcCalls.filter((c) => c.fn === "calendar_events_visible").every((c) => c.range !== null)).toBe(true);
    expect(rpcCalls.filter((c) => c.fn === "calendar_events_visible").length).toBeGreaterThan(1);
  });

  it("drops an occurrence whose event the masked read didn't return", async () => {
    const { ctx } = fakeDb({
      rpcRows: {
        calendar_events_visible: [board],
        calendar_event_occurrences: [occ(board), { event_id: "e-gone", starts_at: board.start_time, ends_at: board.end_time }],
      },
    });
    const out = (await tool("calendar_list_events").handler(
      { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" },
      ctx,
    )) as Row[];
    expect(out.map((e) => e.id)).toEqual(["e-board"]);
  });

  it("before the occurrences read is deployed, falls back to the one-offs in the window", async () => {
    const { ctx } = fakeDb({
      rpcRows: {
        calendar_events_visible: [weekly, board],
        calendar_event_occurrences: {
          error: { message: "Could not find the function public.calendar_event_occurrences", code: "PGRST202" },
        },
      },
    });
    const out = (await tool("calendar_list_events").handler(
      { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" },
      ctx,
    )) as Row[];
    expect(out.map((e) => e.id)).toEqual(["e-board"]);
  });

  it("the composed day carries the day's occurrences too", async () => {
    const { ctx } = fakeDb({
      rpcRows: {
        calendar_events_visible: [weekly],
        calendar_event_occurrences: [occ(weekly, "2026-11-03T10:00:00.000Z", "2026-11-03T10:30:00.000Z")],
      },
    });
    const out = (await tool("calendar_day").handler({ date: "2026-11-03" }, ctx)) as Row;
    expect(out.events.map((e: Row) => [e.id, e.starts_at])).toEqual([["e-weekly", "2026-11-03T10:00:00.000Z"]]);
  });
});

describe("calendar tools · creating and changing events", () => {
  const created = eventRow({ id: "e-new", title: "Investor prep" });

  it("a plain create sends only the original arguments", async () => {
    const { ctx, rpcCalls } = fakeDb({ rpcResult: { calendar_op_event_create: created } });
    await tool("calendar_create_event").handler(
      { title: "Investor prep", starts_at: "2026-11-05T09:00:00Z", ends_at: "2026-11-05T10:30:00Z" },
      ctx,
    );
    const call = rpcCalls.find((c) => c.fn === "calendar_op_event_create")!;
    expect(Object.keys(call.args).sort()).toEqual(
      ["p_all_day", "p_description", "p_ends_at", "p_rrule", "p_starts_at", "p_title", "p_workspace_id"].sort(),
    );
  });

  it("creates with a place, a link, privacy, a calendar and people", async () => {
    const { ctx, rpcCalls } = fakeDb({
      rpcResult: {
        calendar_op_event_create: {
          ...created,
          location: "Hale office",
          conference_url: "https://meet.google.com/abc-defg-hij",
          conference_provider: "google_meet",
          is_private: true,
        },
      },
    });
    const out = (await tool("calendar_create_event").handler(
      {
        title: "Investor prep",
        starts_at: "2026-11-05T09:00:00Z",
        ends_at: "2026-11-05T10:30:00Z",
        place: "Hale office",
        link: "https://meet.google.com/abc-defg-hij",
        private: true,
        calendar_id: WORK,
        people: [{ email: "priya@example.com", name: "Priya" }],
      },
      ctx,
    )) as Row;
    const call = rpcCalls.find((c) => c.fn === "calendar_op_event_create")!;
    expect(call.args).toMatchObject({
      p_workspace_id: WS,
      p_location: "Hale office",
      p_conference_url: "https://meet.google.com/abc-defg-hij",
      p_is_private: true,
      p_calendar_id: WORK,
      p_attendees: [{ email: "priya@example.com", name: "Priya" }],
    });
    expect(out.place).toBe("Hale office");
    expect(out.link).toEqual({ url: "https://meet.google.com/abc-defg-hij", provider: "google_meet" });
    expect(out.private).toBe(true);
  });

  it("an update patches only what it's given, in the op's words", async () => {
    const { ctx, rpcCalls } = fakeDb({ rpcResult: { calendar_op_event_update: created } });
    await tool("calendar_update_event").handler(
      { event_id: "e-new", place: "Café Lisboa", private: true, people: [{ email: "kai@example.com" }] },
      ctx,
    );
    const call = rpcCalls.find((c) => c.fn === "calendar_op_event_update")!;
    expect(call.args.p_event_id).toBe("e-new");
    expect(call.args.p_patch).toEqual({
      location: "Café Lisboa",
      isPrivate: true,
      attendees: [{ email: "kai@example.com" }],
    });
  });

  it("an empty link removes it; a null calendar moves the event back to Your calendar", async () => {
    const { ctx, rpcCalls } = fakeDb({ rpcResult: { calendar_op_event_update: created } });
    await tool("calendar_update_event").handler({ event_id: "e-new", link: "", calendar_id: null, private: false }, ctx);
    const call = rpcCalls.find((c) => c.fn === "calendar_op_event_update")!;
    expect(call.args.p_patch).toEqual({ conferenceUrl: null, calendarId: null, isPrivate: false });
  });

  it("states the new fields in its schema", () => {
    const create = tool("calendar_create_event").inputSchema as Row;
    const update = tool("calendar_update_event").inputSchema as Row;
    for (const schema of [create, update]) {
      for (const field of ["place", "link", "private", "calendar_id", "people"]) {
        expect(schema.properties).toHaveProperty(field);
      }
    }
  });
});

describe("calendar tools · offering times", () => {
  const answer = {
    id: OFFER,
    slug: "4f1c0e9a2b7d4c3e8f6a1b2c3d4e5f60",
    status: "open",
    expires_at: "2026-11-01T09:00:00.000Z",
    hold_event_ids: ["h1", "h2", "h3"],
  };
  const times = ["2026-11-04T10:00:00Z", "2026-11-05T10:00:00Z", "2026-11-06T14:00:00Z"];

  it("offers times from a named link through the op, with holds by default", async () => {
    const { ctx, rpcCalls } = fakeDb({ rpcResult: { calendar_op_offer_create: answer } });
    const out = (await tool("calendar_offer_times").handler({ link_id: LINK, times }, ctx)) as Row;
    const call = rpcCalls.find((c) => c.fn === "calendar_op_offer_create")!;
    expect(call.args).toEqual({ p_workspace_id: WS, p_link_id: LINK, p_starts_at: times, p_hold: true });
    expect(out).toMatchObject({
      offer_id: OFFER,
      url: `https://moduo.app/book/r/${answer.slug}`,
      expires_at: answer.expires_at,
      held: 3,
      status: "open",
    });
  });

  it("sends title, length, video and no holds only when asked", async () => {
    const { ctx, rpcCalls } = fakeDb({ rpcResult: { calendar_op_offer_create: { ...answer, hold_event_ids: [] } } });
    await tool("calendar_offer_times").handler(
      { link_id: LINK, times, hold: false, title: "Investor meeting", duration_minutes: 45, video_provider: "zoom" },
      ctx,
    );
    const call = rpcCalls.find((c) => c.fn === "calendar_op_offer_create")!;
    expect(call.args).toEqual({
      p_workspace_id: WS,
      p_link_id: LINK,
      p_starts_at: times,
      p_hold: false,
      p_title: "Investor meeting",
      p_duration_minutes: 45,
      p_video_provider: "zoom",
    });
  });

  it("without a link, uses the person's first booking link in this workspace", async () => {
    const { ctx, rpcCalls, tableCalls } = fakeDb({
      rpcResult: { calendar_op_offer_create: answer },
      tables: {
        exposed_slot_links: [
          { id: LINK, workspace_id: WS, owner_user_id: ME, deleted_at: null, name: "Intro call" },
          { id: "other", workspace_id: WS, owner_user_id: KAI, deleted_at: null, name: "Kai's link" },
        ],
      },
    });
    await tool("calendar_offer_times").handler({ times }, ctx);
    expect(rpcCalls.find((c) => c.fn === "calendar_op_offer_create")!.args.p_link_id).toBe(LINK);
    const read = tableCalls.find((c) => c.table === "exposed_slot_links")!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ["eq", "workspace_id", WS],
        ["eq", "owner_user_id", ME],
        ["is", "deleted_at", null],
      ]),
    );
  });

  it("with no booking link at all, says how to get one", async () => {
    const { ctx, rpcCalls } = fakeDb({ tables: { exposed_slot_links: [] } });
    await expect(tool("calendar_offer_times").handler({ times }, ctx)).rejects.toThrow(/booking link/i);
    expect(rpcCalls.some((c) => c.fn === "calendar_op_offer_create")).toBe(false);
  });

  it("needs at least one time", async () => {
    const { ctx, rpcCalls } = fakeDb({ rpcResult: { calendar_op_offer_create: answer } });
    await expect(tool("calendar_offer_times").handler({ link_id: LINK, times: [] }, ctx)).rejects.toThrow(/time/i);
    expect(rpcCalls.some((c) => c.fn === "calendar_op_offer_create")).toBe(false);
  });

  it("releases an offer's holds together through the op", async () => {
    const { ctx, rpcCalls } = fakeDb({ rpcResult: { calendar_op_offer_release: "released" } });
    const out = (await tool("calendar_release_offer").handler({ offer_id: OFFER }, ctx)) as Row;
    expect(rpcCalls.find((c) => c.fn === "calendar_op_offer_release")!.args).toEqual({
      p_workspace_id: WS,
      p_offer_id: OFFER,
    });
    expect(out).toEqual({ offer_id: OFFER, status: "released" });
  });

  it("offering is an edit, reading who sees what a view", () => {
    expect(tool("calendar_offer_times").access).toBe("edit");
    expect(tool("calendar_release_offer").access).toBe("edit");
    expect(tool("calendar_who_sees").access).toBe("view");
    expect(tool("calendar_who_sees").hints).toBe("read");
  });
});

describe("calendar tools · who sees what", () => {
  const members = [
    { user_id: ME, perms: null, profiles: { display_name: "Robin Hale" }, workspace_id: WS },
    { user_id: KAI, perms: null, profiles: { display_name: "Kai Ito" }, workspace_id: WS },
    { user_id: NORA, perms: null, profiles: { display_name: "Nora Lind" }, workspace_id: WS },
  ];

  it("for an event: each teammate by name with what they see, and one line", async () => {
    const { ctx, rpcCalls } = fakeDb({
      rpcRows: {
        calendar_who_sees: [
          { calendar_id: WORK, calendar_name: "Work", user_id: KAI, sees: "all" },
          { calendar_id: WORK, calendar_name: "Work", user_id: NORA, sees: "busy" },
        ],
      },
      tables: { workspace_members: members },
    });
    const out = (await tool("calendar_who_sees").handler({ event_id: "e-board" }, ctx)) as Row;
    expect(rpcCalls.find((c) => c.fn === "calendar_who_sees")!.args).toEqual({
      p_workspace_id: WS,
      p_event_id: "e-board",
    });
    expect(out.event_id).toBe("e-board");
    expect(out.calendar_id).toBe(WORK);
    expect(out.people).toEqual([
      { user_id: KAI, name: "Kai Ito", sees: "all" },
      { user_id: NORA, name: "Nora Lind", sees: "busy" },
    ]);
    expect(out.summary).toContain("Kai Ito");
    expect(out.summary).toContain("Nora Lind");
  });

  it("without an event: every calendar of yours with each teammate's level", async () => {
    const { ctx, rpcCalls } = fakeDb({
      rpcRows: {
        calendar_who_sees: [
          { calendar_id: WORK, calendar_name: "Work", user_id: KAI, sees: "all" },
          { calendar_id: WORK, calendar_name: "Work", user_id: NORA, sees: "nothing" },
          { calendar_id: "fam", calendar_name: "Family", user_id: KAI, sees: "busy" },
          { calendar_id: "fam", calendar_name: "Family", user_id: NORA, sees: "busy" },
        ],
      },
      tables: { workspace_members: members },
    });
    const out = (await tool("calendar_who_sees").handler({}, ctx)) as Row;
    expect(rpcCalls.find((c) => c.fn === "calendar_who_sees")!.args).toEqual({ p_workspace_id: WS, p_event_id: null });
    expect(out.calendars).toEqual([
      {
        calendar_id: WORK,
        name: "Work",
        people: [
          { user_id: KAI, name: "Kai Ito", sees: "all" },
          { user_id: NORA, name: "Nora Lind", sees: "nothing" },
        ],
      },
      {
        calendar_id: "fam",
        name: "Family",
        people: [
          { user_id: KAI, name: "Kai Ito", sees: "busy" },
          { user_id: NORA, name: "Nora Lind", sees: "busy" },
        ],
      },
    ]);
  });

  it("passes the op's refusal on", async () => {
    const { ctx } = fakeDb({
      rpcRows: { calendar_who_sees: { error: { message: "Event not found in this workspace." } } },
      tables: { workspace_members: members },
    });
    await expect(tool("calendar_who_sees").handler({ event_id: "e-kai" }, ctx)).rejects.toThrow(
      "Event not found in this workspace.",
    );
  });
});
