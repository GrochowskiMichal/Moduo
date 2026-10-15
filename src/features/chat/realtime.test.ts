import { describe, expect, it, rs } from "@rstest/core";

// Chat's live link: presence on the workspace's private topic, typing on one
// private topic per conversation that only the open conversation joins, and
// "I'm typing" told to the server (chat_op_typing) rather than broadcast from
// here, so the sender on a typing line is always the session's.

type Handler = (msg: { payload: unknown }) => void;
type Channel = {
  topic: string;
  opts: unknown;
  handlers: Map<string, Handler>;
  joined: boolean;
  removed: boolean;
  sent: unknown[];
};
const h = rs.hoisted(() => ({
  channels: [] as Channel[],
  rpcs: [] as { name: string; args: unknown }[],
}));

rs.mock("@/lib/runtime.web", () => ({
  supabaseClient: {
    channel: (topic: string, opts?: unknown) => {
      const ch: Channel = {
        topic,
        opts,
        handlers: new Map(),
        joined: false,
        removed: false,
        sent: [],
      };
      h.channels.push(ch);
      const api = {
        on: (kind: string, filter: { event?: string; table?: string }, fn: Handler) => {
          ch.handlers.set(`${kind}:${filter.event ?? filter.table ?? ""}`, fn);
          return api;
        },
        subscribe: (cb?: (s: string) => void) => {
          ch.joined = true;
          cb?.("SUBSCRIBED");
          return api;
        },
        send: (msg: unknown) => {
          ch.sent.push(msg);
          return Promise.resolve("ok");
        },
        track: () => Promise.resolve("ok"),
        presenceState: () => ({}),
        __ch: ch,
      };
      return api;
    },
    removeChannel: (api: { __ch: Channel }) => {
      api.__ch.removed = true;
      return Promise.resolve("ok");
    },
    rpc: (name: string, args: unknown) => {
      h.rpcs.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

const { acquireChatLink } = await import("./realtime");

/** The newest channel on a topic (an earlier test may have left a removed one). */
const byTopic = (topic: string) => [...h.channels].reverse().find((c) => c.topic === topic);
const typingOn = (topic: string, payload: unknown) =>
  byTopic(topic)?.handlers.get("broadcast:typing")?.({ payload });

describe("chat live link", () => {
  it("keeps presence on the workspace topic and follows typing one conversation at a time", () => {
    const { link, release } = acquireChatLink("ws-1", "me");
    expect(h.channels.map((c) => c.topic)).toEqual(["chat-db:ws-1:me", "chat:ws-1"]);
    const presence = byTopic("chat:ws-1")!;
    expect(presence.opts).toEqual({ config: { private: true, presence: { key: "me" } } });
    expect([...presence.handlers.keys()]).toEqual(["presence:sync"]);

    const stopA = link.watchTyping("c-1");
    const stopB = link.watchTyping("c-1");
    const typing = byTopic("chat:typing:c-1")!;
    expect(h.channels.filter((c) => c.topic === "chat:typing:c-1")).toHaveLength(1);
    expect(typing.opts).toEqual({ config: { private: true } });
    expect([...typing.handlers.keys()]).toEqual(["broadcast:typing"]);
    expect(typing.joined).toBe(true);

    stopA();
    expect(typing.removed).toBe(false);
    stopB();
    stopB();
    expect(typing.removed).toBe(true);

    link.watchTyping("c-2");
    expect(byTopic("chat:typing:c-2")?.joined).toBe(true);
    release();
    expect(byTopic("chat:typing:c-2")?.removed).toBe(true);
    expect(presence.removed).toBe(true);
  });

  it("shows the sender the server named, drops my own echo, and forgets a conversation it leaves", () => {
    const { link, release } = acquireChatLink("ws-2", "me");
    const stop = link.watchTyping("c-1");
    let notified = 0;
    link.subscribeTyping(() => {
      notified += 1;
    });

    typingOn("chat:typing:c-1", { userId: "u2", channelId: "c-1", parentId: null, stop: false });
    expect(link.getTyping().map((t) => [t.userId, t.channelId, t.parentId])).toEqual([
      ["u2", "c-1", null],
    ]);
    expect(notified).toBe(1);

    typingOn("chat:typing:c-1", { userId: "me", channelId: "c-1", parentId: null, stop: false });
    expect(link.getTyping()).toHaveLength(1);

    typingOn("chat:typing:c-1", { userId: "u3", channelId: "c-1", parentId: "m-1", stop: false });
    expect(link.getTyping().map((t) => t.userId)).toEqual(["u2", "u3"]);

    typingOn("chat:typing:c-1", { userId: "u2", channelId: "c-1", parentId: null, stop: true });
    expect(link.getTyping().map((t) => t.userId)).toEqual(["u3"]);

    typingOn("chat:typing:c-1", { channelId: "c-1" });
    expect(link.getTyping()).toHaveLength(1);

    stop();
    expect(link.getTyping()).toEqual([]);
    release();
  });

  it("asks the server to show me as typing, throttled, and never broadcasts from the client", () => {
    rs.useFakeTimers();
    const t0 = new Date("2026-10-14T10:00:00Z").getTime();
    rs.setSystemTime(t0);
    try {
      const { link, release } = acquireChatLink("ws-3", "me");
      const sentBefore = h.channels.reduce((n, c) => n + c.sent.length, 0);
      h.rpcs.length = 0;

      link.sendTyping("c-1", null);
      link.sendTyping("c-1", null);
      expect(h.rpcs).toEqual([
        {
          name: "chat_op_typing",
          args: { p_channel_id: "c-1", p_parent_id: null, p_stop: false },
        },
      ]);

      rs.setSystemTime(t0 + 2_999);
      link.sendTyping("c-1", null);
      expect(h.rpcs).toHaveLength(1);
      rs.setSystemTime(t0 + 3_000);
      link.sendTyping("c-1", null);
      expect(h.rpcs).toHaveLength(2);

      link.sendTyping("c-1", "m-1");
      expect(h.rpcs.at(-1)?.args).toEqual({
        p_channel_id: "c-1",
        p_parent_id: "m-1",
        p_stop: false,
      });

      link.sendTyping("c-1", null, true);
      expect(h.rpcs.at(-1)?.args).toEqual({ p_channel_id: "c-1", p_parent_id: null, p_stop: true });
      link.sendTyping("c-1", null, true);
      expect(h.rpcs).toHaveLength(4);

      expect(h.channels.reduce((n, c) => n + c.sent.length, 0)).toBe(sentBefore);
      release();
    } finally {
      rs.useRealTimers();
    }
  });

  it("reads a membership row stamped left_at as leaving, and an active one as joining", () => {
    const { link, release } = acquireChatLink("ws-4", "me");
    const events: unknown[] = [];
    const stop = link.subscribe((e) => events.push(e));
    // The members subscription is the last postgres_changes handler on the db topic.
    const onMember = byTopic("chat-db:ws-4:me")?.handlers.get("postgres_changes:*");
    const row = {
      channel_id: "c-9",
      user_id: "me",
      workspace_id: "ws-4",
      notify_level: "mentions",
    };

    onMember?.({ eventType: "UPDATE", new: { ...row, left_at: null }, old: {} } as never);
    onMember?.({
      eventType: "UPDATE",
      new: { ...row, left_at: "2026-10-15T09:00:00Z" },
      old: {},
    } as never);
    onMember?.({ eventType: "DELETE", new: {}, old: { channel_id: "c-8" } } as never);

    expect(events.map((e) => (e as { type: string }).type)).toEqual([
      "membership",
      "membership-removed",
      "membership-removed",
    ]);
    expect((events[1] as { channelId: string }).channelId).toBe("c-9");
    stop();
    release();
  });
});
