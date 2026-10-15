import { describe, expect, it } from "@rstest/core";
import { joinNoteLive } from "./runtime.web.notes-live";

const NOTE = "0b5c3a8e-6f1d-4c2a-9e7b-1a2b3c4d5e6f";

type Handler = (arg: any) => void;

function fakeClient(access: boolean[] | boolean) {
  const answers = Array.isArray(access) ? [...access] : null;
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const opened: Array<{ topic: string; opts: any; channel: FakeChannel }> = [];
  const removed: FakeChannel[] = [];

  class FakeChannel {
    handlers: Array<{ type: string; filter: any; cb: Handler }> = [];
    sent: unknown[] = [];
    tracked: unknown[] = [];
    untracked = 0;
    status: ((s: string) => void) | null = null;
    presence: Record<string, unknown[]> = {};
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
    track(meta: unknown) {
      this.tracked.push(meta);
      return Promise.resolve("ok");
    }
    untrack() {
      this.untracked += 1;
      return Promise.resolve("ok");
    }
    presenceState() {
      return this.presence;
    }
    emit(type: string, event: string, arg?: unknown) {
      for (const h of this.handlers) if (h.type === type && h.filter.event === event) h.cb(arg);
    }
  }

  const client = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      const data = answers ? (answers.shift() ?? false) : access;
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
const noop = () => {};

describe("joinNoteLive", () => {
  it("joins the note's PRIVATE topic, keyed by the person, after the access check", async () => {
    const { client, rpcCalls, opened } = fakeClient(true);
    joinNoteLive(client, { noteId: NOTE, selfUserId: "me", onBroadcast: noop, onPresence: noop });
    await flush();
    expect(rpcCalls).toEqual([
      { fn: "share_can", args: { p_type: "note", p_id: NOTE, p_min: "view" } },
    ]);
    expect(opened).toHaveLength(1);
    expect(opened[0].topic).toBe(`note:${NOTE}`);
    expect(opened[0].opts.config).toMatchObject({ private: true, presence: { key: "me" } });
  });

  it("tracks nothing a peer would show: presence carries no name", async () => {
    const { client, opened } = fakeClient(true);
    joinNoteLive(client, { noteId: NOTE, selfUserId: "me", onBroadcast: noop, onPresence: noop });
    await flush();
    opened[0].channel.status?.("SUBSCRIBED");
    expect(opened[0].channel.tracked).toHaveLength(1);
    expect(Object.keys(opened[0].channel.tracked[0] as object)).toEqual(["at"]);
  });

  it("re-asks a few times for a just-created note, then opens nothing without access", async () => {
    const { client, rpcCalls, opened } = fakeClient([false, false, false, false, false]);
    joinNoteLive(
      client,
      { noteId: NOTE, selfUserId: "me", onBroadcast: noop, onPresence: noop },
      { retryMs: 0 },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(rpcCalls).toHaveLength(5);
    expect(opened).toHaveLength(0);
  });

  it("joins once access appears (the note was saved a moment later)", async () => {
    const { client, opened } = fakeClient([false, true]);
    joinNoteLive(
      client,
      { noteId: NOTE, selfUserId: "me", onBroadcast: noop, onPresence: noop },
      { retryMs: 0 },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(opened).toHaveLength(1);
  });

  it("relays updates only while joined", async () => {
    const { client, opened } = fakeClient(true);
    const live = joinNoteLive(client, {
      noteId: NOTE,
      selfUserId: "me",
      onBroadcast: noop,
      onPresence: noop,
    });
    live.sendUpdate("early"); // still checking access
    await flush();
    const ch = opened[0].channel;
    live.sendUpdate("joining"); // channel opened, not joined
    ch.status?.("SUBSCRIBED");
    live.sendUpdate("QQ==");
    ch.status?.("CHANNEL_ERROR");
    live.sendUpdate("after-error");
    expect(ch.sent).toEqual([{ type: "broadcast", event: "u", payload: { b64: "QQ==" } }]);
  });

  it("hands broadcasts and presence to the editor", async () => {
    const { client, opened } = fakeClient(true);
    const got: unknown[] = [];
    const presence: unknown[] = [];
    joinNoteLive(client, {
      noteId: NOTE,
      selfUserId: "me",
      onBroadcast: (p) => got.push(p),
      onPresence: (s) => presence.push(s),
    });
    await flush();
    const ch = opened[0].channel;
    ch.emit("broadcast", "u", { payload: { origin: "api_key" } });
    ch.presence = { u1: [{ at: 1 }] };
    ch.emit("presence", "sync");
    expect(got).toEqual([{ origin: "api_key" }]);
    expect(presence).toEqual([{ u1: [{ at: 1 }] }]);
  });

  it("closing before the access check returns opens nothing; closing after leaves the channel", async () => {
    const early = fakeClient(true);
    joinNoteLive(early.client, {
      noteId: NOTE,
      selfUserId: "me",
      onBroadcast: noop,
      onPresence: noop,
    }).close();
    await flush();
    expect(early.opened).toHaveLength(0);

    const late = fakeClient(true);
    const live = joinNoteLive(late.client, {
      noteId: NOTE,
      selfUserId: "me",
      onBroadcast: noop,
      onPresence: noop,
    });
    await flush();
    const ch = late.opened[0].channel;
    ch.status?.("SUBSCRIBED");
    live.close();
    live.sendUpdate("QQ==");
    expect(ch.untracked).toBe(1);
    expect(late.removed).toEqual([ch]);
    expect(ch.sent).toEqual([]);
  });
});
