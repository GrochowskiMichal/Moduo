import { describe, expect, it, rs } from "@rstest/core";
import type { TasksLiveEvent } from "./realtime";

// TV-D5 (D5-3, socket side): one shared channel per workspace and person, a
// resync on every rejoin after the first, and one per return to the window.
// TV-D11b: its tables (completions, the grant feed) listen on channels of
// their own, so one not yet published can't silence the main one.

type Handler = (payload: unknown) => void;
const h = rs.hoisted(() => ({
  channels: [] as {
    topic: string;
    tables: string[];
    filters: string[];
    handlers: Map<string, (payload: unknown) => void>;
    status: ((s: string) => void) | null;
    removed: boolean;
  }[],
}));

rs.mock("@/lib/runtime.web", () => ({
  supabaseClient: {
    channel: (topic: string) => {
      const ch = {
        topic,
        tables: [] as string[],
        filters: [] as string[],
        handlers: new Map<string, Handler>(),
        status: null as ((s: string) => void) | null,
        removed: false,
      };
      h.channels.push(ch);
      const api = {
        on: (_kind: string, opts: { table: string; filter: string }, fn: Handler) => {
          ch.tables.push(opts.table);
          ch.filters.push(opts.filter);
          ch.handlers.set(opts.table, fn);
          return api;
        },
        subscribe: (cb: (s: string) => void) => {
          ch.status = cb;
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

const { listenTasksLive } = await import("./realtime");

/** The channels one listen opened, by topic. */
const opened = (from: number) => h.channels.slice(from);
const mainOf = (from: number) => opened(from).find((c) => c.topic.startsWith("tasks-db:ws"))!;

describe("listenTasksLive", () => {
  it("shares one channel per workspace, filtered by it, and closes with the last listener", () => {
    const a: TasksLiveEvent[] = [];
    const b: TasksLiveEvent[] = [];
    const stopA = listenTasksLive("ws-1", "me", (e) => a.push(e));
    const stopB = listenTasksLive("ws-1", "me", (e) => b.push(e));
    // The main channel, then one each for TV-D11b's tables.
    expect(h.channels.map((c) => c.topic)).toEqual([
      "tasks-db:ws-1:me",
      "tasks-db:task_completions:ws-1:me",
      "tasks-access:ws-1:me",
    ]);
    const ch = h.channels[0]!;
    expect(ch.tables).toEqual([
      "tasks",
      "buckets",
      "tags",
      "tag_links",
      "task_queue",
      // TV-D11a: statuses and comment counts are live too, and TV-D10's tables.
      "project_statuses",
      "comments",
      "areas",
      "sections",
      "teams",
      "team_members",
      "task_sessions",
      "task_reminders",
      "task_waiting",
    ]);
    expect(new Set(ch.filters)).toEqual(new Set(["workspace_id=eq.ws-1"]));
    expect(h.channels[1]!.tables).toEqual(["task_completions"]);
    expect(h.channels[2]!.tables).toEqual(["access_changes"]);
    expect(new Set(h.channels.flatMap((c) => c.filters))).toEqual(
      new Set(["workspace_id=eq.ws-1"]),
    );

    ch.handlers.get("tag_links")!({ eventType: "DELETE", old: { id: "l1" } });
    expect(a).toEqual([
      { type: "change", change: { table: "tag_links", kind: "delete", id: "l1" } },
    ]);
    expect(b).toHaveLength(1);
    // Unreadable payloads are dropped.
    ch.handlers.get("tasks")!({ eventType: "UPDATE", new: { id: 1 } });
    expect(a).toHaveLength(1);

    // A completion lands like any change; a grant feed row says who sees what changed.
    h.channels[1]!.handlers.get("task_completions")!({
      eventType: "INSERT",
      new: {
        id: "c1",
        workspace_id: "ws-1",
        task_id: "t1",
        user_id: "me",
        completed_at: "2026-10-11T10:00:00+00:00",
        cycle_key: "2026-10-11",
        updated_at: "2026-10-11T10:00:00+00:00",
        deleted_at: null,
      },
    });
    expect(a.at(-1)).toMatchObject({
      type: "change",
      change: { table: "task_completions", kind: "upsert", row: { id: "c1", taskId: "t1" } },
    });
    h.channels[2]!.handlers.get("access_changes")!({
      eventType: "INSERT",
      new: {
        id: 7,
        resource_type: "task",
        resource_id: "t9",
        changed_at: "2026-10-11T10:01:00+00:00",
      },
    });
    expect(a.at(-1)).toEqual({
      type: "access",
      change: {
        id: "7",
        resourceType: "task",
        resourceId: "t9",
        changedAt: "2026-10-11T10:01:00+00:00",
      },
    });

    stopA();
    expect(ch.removed).toBe(false);
    stopB();
    stopB();
    expect(h.channels.every((c) => c.removed)).toBe(true);
    // A fresh listener opens fresh channels.
    const stopC = listenTasksLive("ws-1", "me", () => {});
    expect(h.channels).toHaveLength(6);
    stopC();
  });

  it("asks for a refetch on rejoin (not the first join), on return and on reconnect", () => {
    const got: TasksLiveEvent[] = [];
    const from = h.channels.length;
    const stop = listenTasksLive("ws-2", "me", (e) => got.push(e));
    const ch = mainOf(from);
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
