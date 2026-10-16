import { describe, expect, it } from "@rstest/core";
import { joinNoteLive } from "./runtime.web.notes-live";

const NOTE = "0b5c3a8e-6f1d-4c2a-9e7b-1a2b3c4d5e6f";
const OTHER = "1b5c3a8e-6f1d-4c2a-9e7b-1a2b3c4d5e6f";

type Handler = (arg: any) => void;

class FakeChannel {
  handlers: Array<{ type: string; filter: any; cb: Handler }> = [];
  status: ((s: string) => void) | null = null;
  sent: unknown[] = [];
  on(type: string, filter: any, cb: Handler) {
    this.handlers.push({ type, filter, cb });
    return this;
  }
  subscribe(cb: (s: string) => void) {
    this.status = cb;
    return this;
  }
  send(msg: unknown) {
    this.sent.push(msg);
    return Promise.resolve("ok");
  }
  track() {
    this.sent.push("track");
    return Promise.resolve("ok");
  }
  emit(event: string, payload: unknown) {
    for (const h of this.handlers) if (h.filter.event === event) h.cb({ payload });
  }
}

/** `here` answers per call: an id list, or null (refused). */
function fakeClient(here: Array<string[] | null> | string[] | null = ["me"]) {
  const queue =
    Array.isArray(here) && here.every((h) => h === null || Array.isArray(h))
      ? [...(here as Array<string[] | null>)]
      : null;
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  const opened: Array<{ topic: string; opts: any; channel: FakeChannel }> = [];
  const removed: FakeChannel[] = [];
  const client = {
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (args.p_leaving) return { data: [], error: null };
      const data = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : here;
      return { data, error: null };
    },
    channel: (topic: string, opts: unknown) => {
      const channel = new FakeChannel();
      opened.push({ topic, opts, channel });
      return channel;
    },
    removeChannel: async (channel: FakeChannel) => {
      removed.push(channel);
      return "ok";
    },
  };
  return { client: client as any, rpcCalls, opened, removed };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const handlers = () => {
  const got = { updates: [] as string[][], pulls: 0, viewers: [] as string[][] };
  return {
    got,
    join: {
      onUpdates: (u: string[]) => got.updates.push(u),
      onPull: () => {
        got.pulls += 1;
      },
      onViewers: (v: string[]) => got.viewers.push(v),
    },
  };
};

describe("joinNoteLive", () => {
  it("listens on the person's own private topic and sends nothing over Realtime", async () => {
    const { client, opened } = fakeClient();
    const { join } = handlers();
    joinNoteLive(client, { noteId: NOTE, selfUserId: "me", ...join }, { sessionId: "s1" });
    await flush();
    expect(opened).toHaveLength(1);
    expect(opened[0].topic).toBe("notes-live:me");
    expect(opened[0].opts.config).toEqual({ private: true });
    opened[0].channel.status?.("SUBSCRIBED");
    expect(opened[0].channel.sent).toEqual([]);
  });

  it("says it's here through the server, which answers who is viewing", async () => {
    const { client, rpcCalls } = fakeClient([["me", "ada"]]);
    const { got, join } = handlers();
    const live = joinNoteLive(
      client,
      { noteId: NOTE, selfUserId: "me", ...join },
      { sessionId: "s1" },
    );
    await flush();
    expect(rpcCalls[0]).toEqual({
      fn: "notes_live_here",
      args: { p_note_id: NOTE, p_session_id: "s1", p_leaving: false },
    });
    expect(got.viewers).toEqual([["me", "ada"]]);
    live.close();
  });

  it("re-asks quickly while refused (a just-created note), then keeps the slow beat", async () => {
    const { client, rpcCalls } = fakeClient([null, null, ["me"]]);
    const { got, join } = handlers();
    const live = joinNoteLive(
      client,
      { noteId: NOTE, selfUserId: "me", ...join },
      { sessionId: "s1", earlyRetryMs: 0, heartbeatMs: 60_000 },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(rpcCalls.filter((c) => !c.args.p_leaving)).toHaveLength(3);
    expect(got.viewers).toEqual([[], [], ["me"]]);
    live.close();
  });

  it("applies inline updates for its note, pulls on an announced one, ignores other notes", async () => {
    const { client, opened } = fakeClient();
    const { got, join } = handlers();
    const live = joinNoteLive(client, { noteId: NOTE, selfUserId: "me", ...join });
    await flush();
    const ch = opened[0].channel;
    ch.emit("changed", { noteId: NOTE, updates: ["QQ=="] });
    ch.emit("changed", { noteId: NOTE, pull: true });
    ch.emit("changed", { noteId: OTHER, updates: ["Qg=="] });
    ch.emit("viewers", { noteId: NOTE, viewers: ["me", "ada"] });
    ch.emit("viewers", { noteId: OTHER, viewers: ["bob"] });
    expect(got.updates).toEqual([["QQ=="]]);
    expect(got.pulls).toBe(1);
    expect(got.viewers.at(-1)).toEqual(["me", "ada"]);
    live.close();
  });

  it("catches up with a pull after the socket rejoins", async () => {
    const { client, opened } = fakeClient();
    const { got, join } = handlers();
    const live = joinNoteLive(client, { noteId: NOTE, selfUserId: "me", ...join });
    await flush();
    const ch = opened[0].channel;
    ch.status?.("SUBSCRIBED");
    expect(got.pulls).toBe(0);
    ch.status?.("CHANNEL_ERROR");
    ch.status?.("SUBSCRIBED");
    expect(got.pulls).toBe(1);
    live.close();
  });

  it("shares one topic between open notes and leaves it with the last one", async () => {
    const { client, opened, removed } = fakeClient();
    const a = joinNoteLive(client, { noteId: NOTE, selfUserId: "me", ...handlers().join });
    const b = joinNoteLive(client, { noteId: OTHER, selfUserId: "me", ...handlers().join });
    await flush();
    expect(opened).toHaveLength(1);
    a.close();
    expect(removed).toEqual([]);
    b.close();
    expect(removed).toEqual([opened[0].channel]);
  });

  it("says goodbye on close and reports nothing after", async () => {
    const { client, opened, rpcCalls } = fakeClient();
    const { got, join } = handlers();
    const live = joinNoteLive(
      client,
      { noteId: NOTE, selfUserId: "me", ...join },
      { sessionId: "s1" },
    );
    await flush();
    const ch = opened[0].channel;
    live.close();
    ch.emit("changed", { noteId: NOTE, updates: ["QQ=="] });
    ch.emit("viewers", { noteId: NOTE, viewers: ["ada"] });
    expect(rpcCalls.at(-1)).toEqual({
      fn: "notes_live_here",
      args: { p_note_id: NOTE, p_session_id: "s1", p_leaving: true },
    });
    expect(got.updates).toEqual([]);
    expect(got.viewers).toEqual([["me"]]);
  });
});
