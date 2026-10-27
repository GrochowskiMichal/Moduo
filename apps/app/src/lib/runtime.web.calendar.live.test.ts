// CALR-7 (specs/calendar-rethink.md AC42), the socket half: the web runtime's
// `calendar.listenLive` opens one Realtime channel per workspace and person,
// shared by every listener, filtered by workspace; inserts, updates and deletes
// of calendar_events become changes carrying the mapped event (or the deleted
// id); every rejoin after the first, a return to the window and the network
// coming back ask for a resync.

import { describe, expect, it, rs } from "@rstest/core";

import type { CalendarLiveEvent } from "../features/calendar/events";
import { webCalendar } from "./runtime.web.calendar";

type Handler = (payload: unknown) => void;
const h = rs.hoisted(() => ({
  channels: [] as {
    topic: string;
    tables: string[];
    filters: string[];
    events: string[];
    handlers: Map<string, (payload: unknown) => void>;
    status: ((s: string) => void) | null;
    removed: boolean;
  }[],
}));

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    channel: (topic: string) => {
      const ch = {
        topic,
        tables: [] as string[],
        filters: [] as string[],
        events: [] as string[],
        handlers: new Map<string, Handler>(),
        status: null as ((s: string) => void) | null,
        removed: false,
      };
      h.channels.push(ch);
      const api = {
        on: (
          _kind: string,
          opts: { event: string; table: string; filter: string },
          fn: Handler,
        ) => {
          ch.tables.push(opts.table);
          ch.filters.push(opts.filter);
          ch.events.push(opts.event);
          ch.handlers.set(opts.table, fn);
          return api;
        },
        subscribe: (cb?: (s: string) => void) => {
          ch.status = cb ?? null;
          return api;
        },
        __ch: ch,
      };
      return api;
    },
    removeChannel: (api: { __ch: { removed: boolean } }) => {
      api.__ch.removed = true;
      return Promise.resolve("ok");
    },
  },
}));

const ROW = {
  id: "e1",
  workspace_id: "ws-1",
  owner_id: "kai",
  source_account_id: null,
  external_event_id: null,
  calendar_id: "moduo",
  calendar_ref: "cal-kai",
  title: "Legal review",
  description: "",
  start_time: "2026-11-05T10:00:00Z",
  end_time: "2026-11-05T11:00:00Z",
  all_day: false,
  recurrence_rule: null,
  status: "confirmed",
  location: "Room 4",
  color: null,
  created_at: "2026-10-28T08:00:00Z",
  updated_at: "2026-10-28T08:00:00Z",
  deleted_at: null,
};

const calendarChannels = (from: number) =>
  h.channels.slice(from).filter((c) => c.tables.includes("calendar_events"));

describe("webCalendar.listenLive (CALR-7)", () => {
  it("shares one channel per workspace and person, filtered by workspace, closed with the last listener", () => {
    const from = h.channels.length;
    const stopA = webCalendar.listenLive({ workspaceId: "ws-1", selfId: "me" }, () => {});
    const stopB = webCalendar.listenLive({ workspaceId: "ws-1", selfId: "me" }, () => {});
    const opened = calendarChannels(from);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.topic).toContain("ws-1");
    expect(opened[0]!.topic).toContain("me");
    expect(opened[0]!.filters).toEqual(["workspace_id=eq.ws-1"]);
    expect(opened[0]!.events).toEqual(["*"]);

    const stopOther = webCalendar.listenLive({ workspaceId: "ws-2", selfId: "me" }, () => {});
    expect(calendarChannels(from)).toHaveLength(2);

    stopA();
    expect(opened[0]!.removed).toBe(false);
    stopB();
    stopB(); // a second call is harmless
    expect(opened[0]!.removed).toBe(true);
    stopOther();

    // After the last listener let go, a new listen opens a fresh channel.
    const again = webCalendar.listenLive({ workspaceId: "ws-1", selfId: "me" }, () => {});
    expect(calendarChannels(from)).toHaveLength(4);
    again();
  });

  it("turns inserts, updates and deletes into changes", () => {
    const got: CalendarLiveEvent[] = [];
    const from = h.channels.length;
    const stop = webCalendar.listenLive({ workspaceId: "ws-1", selfId: "me" }, (e) => got.push(e));
    const ch = calendarChannels(from)[0]!;
    const fire = ch.handlers.get("calendar_events")!;

    fire({ eventType: "INSERT", new: ROW, old: {} });
    fire({
      eventType: "UPDATE",
      new: { ...ROW, title: "Legal review (moved)" },
      old: { id: "e1" },
    });
    fire({
      eventType: "UPDATE",
      new: { ...ROW, deleted_at: "2026-10-28T09:00:00Z" },
      old: { id: "e1" },
    });
    fire({ eventType: "DELETE", new: {}, old: { id: "e9" } });

    expect(got).toHaveLength(4);
    expect(got[0]).toMatchObject({
      type: "change",
      change: {
        kind: "upsert",
        event: { id: "e1", title: "Legal review", calendarRef: "cal-kai", location: "Room 4" },
      },
    });
    expect(got[1]).toMatchObject({
      type: "change",
      change: { kind: "upsert", event: { title: "Legal review (moved)" } },
    });
    expect(got[2]).toMatchObject({
      type: "change",
      change: { kind: "upsert", event: { id: "e1", deletedAt: "2026-10-28T09:00:00Z" } },
    });
    expect(got[3]).toEqual({ type: "change", change: { kind: "delete", id: "e9" } });
    stop();
  });

  it("drops payloads it can't read instead of throwing", () => {
    const got: CalendarLiveEvent[] = [];
    const from = h.channels.length;
    const stop = webCalendar.listenLive({ workspaceId: "ws-1", selfId: "me" }, (e) => got.push(e));
    const fire = calendarChannels(from)[0]!.handlers.get("calendar_events")!;
    expect(() => fire({ eventType: "INSERT", new: { id: "x" }, old: {} })).not.toThrow();
    expect(() => fire({ eventType: "DELETE", new: {}, old: {} })).not.toThrow();
    expect(() => fire(null)).not.toThrow();
    expect(got).toEqual([]);
    stop();
  });

  it("asks for a resync on rejoin (not the first join), on return and when back online", () => {
    const got: CalendarLiveEvent[] = [];
    const from = h.channels.length;
    const stop = webCalendar.listenLive({ workspaceId: "ws-3", selfId: "me" }, (e) => got.push(e));
    const ch = calendarChannels(from)[0]!;
    ch.status!("SUBSCRIBED");
    expect(got).toEqual([]);
    ch.status!("CHANNEL_ERROR");
    ch.status!("SUBSCRIBED");
    expect(got).toEqual([{ type: "resync", reason: "reconnect" }]);

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    expect(got.slice(1)).toEqual([
      { type: "resync", reason: "return" },
      { type: "resync", reason: "reconnect" },
    ]);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(got).toHaveLength(3);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(got.at(-1)).toEqual({ type: "resync", reason: "return" });

    stop();
    window.dispatchEvent(new Event("focus"));
    expect(got).toHaveLength(4);
  });
});
