import { describe, expect, it, rs } from "@rstest/core";
import type { TasksLiveEvent } from "./realtime";

// TV-D5 (D5-3, socket side): one shared channel per workspace and person, a
// resync on every rejoin after the first, and one per return to the window.

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

describe("listenTasksLive", () => {
  it("shares one channel per workspace, filtered by it, and closes with the last listener", () => {
    const a: TasksLiveEvent[] = [];
    const b: TasksLiveEvent[] = [];
    const stopA = listenTasksLive("ws-1", "me", (e) => a.push(e));
    const stopB = listenTasksLive("ws-1", "me", (e) => b.push(e));
    expect(h.channels).toHaveLength(1);
    const ch = h.channels[0]!;
    expect(ch.topic).toBe("tasks-db:ws-1:me");
    expect(ch.tables).toEqual(["tasks", "buckets", "tags", "tag_links", "task_queue"]);
    expect(new Set(ch.filters)).toEqual(new Set(["workspace_id=eq.ws-1"]));

    ch.handlers.get("tag_links")!({ eventType: "DELETE", old: { id: "l1" } });
    expect(a).toEqual([
      { type: "change", change: { table: "tag_links", kind: "delete", id: "l1" } },
    ]);
    expect(b).toHaveLength(1);
    // Unreadable payloads are dropped.
    ch.handlers.get("tasks")!({ eventType: "UPDATE", new: { id: 1 } });
    expect(a).toHaveLength(1);

    stopA();
    expect(ch.removed).toBe(false);
    stopB();
    stopB();
    expect(ch.removed).toBe(true);
    // A fresh listener opens a fresh channel.
    const stopC = listenTasksLive("ws-1", "me", () => {});
    expect(h.channels).toHaveLength(2);
    stopC();
  });

  it("asks for a refetch on rejoin (not the first join), on return and on reconnect", () => {
    const got: TasksLiveEvent[] = [];
    const stop = listenTasksLive("ws-2", "me", (e) => got.push(e));
    const ch = h.channels.at(-1)!;
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

    stop();
    window.dispatchEvent(new Event("focus"));
    expect(got).toHaveLength(3);
  });
});
