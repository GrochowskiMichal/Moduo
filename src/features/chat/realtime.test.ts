import { describe, expect, it } from "@rstest/core";

// Chat's live layer (CV-3): the Postgres Changes adapter the store's merge
// takes its input from (the message binding narrowed with `select`, a join
// counted only once Realtime says "Subscribed to PostgreSQL"), and the typing
// and presence stores: typing on one private topic per open conversation, told
// to the server rather than broadcast, and a refused join is an error state,
// never an empty "everyone away" (AC1.9).

import { CHAT_MESSAGE_COLUMN_LIST } from "./columns";
import { type ChatLiveEvent, type ChatSocket, postgresChangesSource } from "./realtime";
import { ChatPresenceStore } from "./store/presence";
import { ChatTypingStore, TYPING_THROTTLE_MS, TYPING_TTL_MS } from "./store/typing";

type Handler = (payload: unknown) => void;
type FakeChannel = {
  topic: string;
  opts: unknown;
  bindings: { kind: string; filter: Record<string, unknown>; fn: Handler }[];
  status: ((s: string) => void) | null;
  removed: boolean;
  tracked: unknown[];
  presence: Record<string, unknown>;
};

function fakeSocket() {
  const channels: FakeChannel[] = [];
  const socket = {
    channel: (topic: string, opts?: unknown) => {
      const ch: FakeChannel = {
        topic,
        opts,
        bindings: [],
        status: null,
        removed: false,
        tracked: [],
        presence: {},
      };
      channels.push(ch);
      const api = {
        on: (kind: string, filter: Record<string, unknown>, fn: Handler) => {
          ch.bindings.push({ kind, filter, fn });
          return api;
        },
        subscribe: (cb?: (s: string) => void) => {
          ch.status = cb ?? null;
          return api;
        },
        track: (state: unknown) => {
          ch.tracked.push(state);
          return Promise.resolve("ok");
        },
        presenceState: () => ch.presence,
        __ch: ch,
      };
      return api;
    },
    removeChannel: (api: { __ch: FakeChannel }) => {
      api.__ch.removed = true;
      return Promise.resolve("ok");
    },
  };
  const fire = (ch: FakeChannel, kind: string, payload: unknown, event?: string) => {
    for (const b of ch.bindings) {
      if (b.kind === kind && (!event || b.filter.event === event)) b.fn(payload);
    }
  };
  return { socket: socket as unknown as ChatSocket, channels, fire };
}

const WS = "ws-1";
const settle = () => new Promise((r) => setTimeout(r, 0));
const ME = "me";

describe("postgresChangesSource", () => {
  it("binds the message table with `select`, each source its own channel", () => {
    const { socket, channels } = fakeSocket();
    const stop = postgresChangesSource(socket)({ workspaceId: WS, userId: ME }, () => {});
    const topics = channels.map((c) => c.topic);
    const n = topics[0]!.split(":").at(-1);
    expect(topics).toEqual([
      `chat-messages:${WS}:${ME}:${n}`,
      `chat-channels:${WS}:${ME}:${n}`,
      `chat-members:${WS}:${ME}:${n}`,
      `chat-catchup:${WS}:${ME}:${n}`,
    ]);
    const messages = channels[0]!.bindings.find((b) => b.kind === "postgres_changes")!;
    expect(messages.filter).toMatchObject({
      table: "chat_messages",
      filter: `workspace_id=eq.${WS}`,
      select: [...CHAT_MESSAGE_COLUMN_LIST],
    });
    expect(messages.filter.select).not.toContain("search_tsv");
    expect(messages.filter.select).not.toContain("body_text");
    expect(channels[2]!.bindings[0]!.filter).toMatchObject({ filter: `user_id=eq.${ME}` });
    stop();
    expect(channels.every((c) => c.removed)).toBe(true);
  });

  it("says joined only once Realtime is subscribed to Postgres, and maps rows", () => {
    const { socket, channels, fire } = fakeSocket();
    const events: ChatLiveEvent[] = [];
    postgresChangesSource(socket)({ workspaceId: WS, userId: ME }, (e) => events.push(e));
    const [messages, , members] = channels;
    messages!.status?.("SUBSCRIBED");
    expect(events).toEqual([]);
    fire(messages!, "system", { extension: "postgres_changes", status: "ok" });
    expect(events).toEqual([{ type: "joined", source: "messages" }]);

    const row = {
      id: "m1",
      channel_id: "c1",
      workspace_id: WS,
      created_at: "2026-10-14T11:25:24.355604+00:00",
      updated_at: "2026-10-14T11:25:24.355604+00:00",
      kind: "message",
      format_version: 2,
    };
    fire(messages!, "postgres_changes", { eventType: "INSERT", new: row, old: {} });
    fire(messages!, "postgres_changes", {
      eventType: "UPDATE",
      new: { ...row, body: "x" },
      old: {},
    });
    fire(messages!, "postgres_changes", { eventType: "DELETE", new: {}, old: { id: "m1" } });
    expect(events.slice(1).map((e) => [e.type, "insert" in e ? e.insert : null])).toEqual([
      ["message", true],
      ["message", false],
      ["message-gone", null],
    ]);
    expect(events[1]).toMatchObject({ row: { id: "m1", updatedAt: row.updated_at } });

    // Leaving or a removal stamps the row: no longer a membership.
    fire(members!, "postgres_changes", {
      eventType: "UPDATE",
      new: { channel_id: "c1", user_id: ME, workspace_id: WS, left_at: "2026-10-14T12:00:00Z" },
    });
    expect(events.at(-1)).toEqual({ type: "member-left", channelId: "c1" });
    messages!.status?.("CHANNEL_ERROR");
    expect(events.at(-1)).toEqual({ type: "lost", source: "messages" });
  });

  it("only your own membership leaves; a removed row is a bare key and says nothing (CV-22)", () => {
    const { socket, channels, fire } = fakeSocket();
    const events: ChatLiveEvent[] = [];
    postgresChangesSource(socket)({ workspaceId: WS, userId: ME }, (e) => events.push(e));
    const members = channels[2]!;
    // A removed row: its old record is the row's own id, nothing else.
    fire(members, "postgres_changes", { eventType: "DELETE", new: {}, old: { id: "row-1" } });
    // Your row in another workspace stamped as left.
    fire(members, "postgres_changes", {
      eventType: "UPDATE",
      new: { channel_id: "c9", user_id: ME, workspace_id: "ws-2", left_at: "2026-10-14T12:00:00Z" },
    });
    // Someone else's row in this workspace.
    fire(members, "postgres_changes", {
      eventType: "UPDATE",
      new: {
        channel_id: "general",
        user_id: "ana",
        workspace_id: WS,
        left_at: "2026-10-14T12:00:00Z",
      },
    });
    expect(events).toEqual([]);
    fire(members, "postgres_changes", {
      eventType: "UPDATE",
      new: {
        channel_id: "general",
        user_id: ME,
        workspace_id: WS,
        left_at: "2026-10-14T12:00:00Z",
      },
    });
    expect(events).toEqual([{ type: "member-left", channelId: "general" }]);
  });

  it("your Catch up rows recount only their own workspace (CV-6b review)", () => {
    const { socket, channels, fire } = fakeSocket();
    const events: ChatLiveEvent[] = [];
    postgresChangesSource(socket)({ workspaceId: WS, userId: ME }, (e) => events.push(e));
    const catchup = channels[3]!;
    fire(catchup, "postgres_changes", {
      eventType: "INSERT",
      new: { id: "k1", user_id: ME, workspace_id: "ws-2" },
    });
    expect(events).toEqual([]);
    fire(catchup, "postgres_changes", {
      eventType: "UPDATE",
      new: { id: "k2", user_id: ME, workspace_id: WS },
    });
    // A delete's old record is the key alone: it recounts.
    fire(catchup, "postgres_changes", { eventType: "DELETE", new: {}, old: { id: "k3" } });
    expect(events).toEqual([{ type: "catchup" }, { type: "catchup" }]);
  });

  it("a restart joins new channels, never the ones still leaving", () => {
    const { socket, channels } = fakeSocket();
    const source = postgresChangesSource(socket);
    source({ workspaceId: WS, userId: ME }, () => {})();
    source({ workspaceId: WS, userId: ME }, () => {});
    const topics = channels.map((c) => c.topic);
    expect(new Set(topics).size).toBe(8);
  });
});

describe("ChatTypingStore", () => {
  it("joins only the open conversation's private topic and leaves it on release", () => {
    const { socket, channels } = fakeSocket();
    const typing = new ChatTypingStore(socket, { typing: async () => {} }, ME);
    const leaveA = typing.watch("a");
    const leaveA2 = typing.watch("a");
    expect(channels.map((c) => [c.topic, c.opts])).toEqual([
      ["chat:typing:a", { config: { private: true } }],
    ]);
    leaveA();
    expect(channels[0]!.removed).toBe(false);
    leaveA2();
    expect(channels[0]!.removed).toBe(true);
    typing.watch("b");
    expect(channels.at(-1)!.topic).toBe("chat:typing:b");
  });

  it("watched again while its topic is still leaving: joins once it has left", async () => {
    const { socket, channels } = fakeSocket();
    const typing = new ChatTypingStore(socket, { typing: async () => {} }, ME);
    typing.watch("a")();
    const release = typing.watch("a");
    expect(channels).toHaveLength(1);
    await settle();
    expect(channels.map((c) => [c.topic, c.removed])).toEqual([
      ["chat:typing:a", true],
      ["chat:typing:a", false],
    ]);
    // Released before it joined: nothing joins.
    release();
    typing.watch("a")();
    await settle();
    expect(channels).toHaveLength(2);
  });

  it("tells the server at most once every 3 s, stops at once, and never shows yourself", () => {
    let now = 1_000_000;
    const sent: unknown[] = [];
    const { socket, channels, fire } = fakeSocket();
    const typing = new ChatTypingStore(
      socket,
      {
        typing: async (args) => {
          sent.push(args);
        },
      },
      ME,
      () => now,
    );
    typing.send("a", null);
    typing.send("a", null);
    now += TYPING_THROTTLE_MS;
    typing.send("a", null);
    typing.send("a", null, true);
    expect(sent).toEqual([
      { channelId: "a", parentId: null, stop: false },
      { channelId: "a", parentId: null, stop: false },
      { channelId: "a", parentId: null, stop: true },
    ]);

    typing.watch("a");
    fire(channels[0]!, "broadcast", { payload: { userId: ME, channelId: "a" } });
    expect(typing.getSnapshot().entries).toEqual([]);
    fire(channels[0]!, "broadcast", { payload: { userId: "ana", channelId: "a", parentId: null } });
    expect(typing.getSnapshot().entries).toEqual([
      { userId: "ana", channelId: "a", parentId: null, until: now + TYPING_TTL_MS },
    ]);
    fire(channels[0]!, "broadcast", { payload: { userId: "ana", channelId: "a", stop: true } });
    expect(typing.getSnapshot().entries).toEqual([]);
    typing.dispose();
  });

  it("a refused join is an error state, not an empty line (AC1.9)", () => {
    const { socket, channels } = fakeSocket();
    const typing = new ChatTypingStore(socket, { typing: async () => {} }, ME);
    typing.watch("a");
    channels[0]!.status?.("CHANNEL_ERROR");
    expect(typing.getSnapshot().error).toBe("Typing isn't available");
    channels[0]!.status?.("SUBSCRIBED");
    expect(typing.getSnapshot().error).toBeNull();
  });
});

describe("ChatPresenceStore", () => {
  it("tracks you once joined and shows who's online", () => {
    const { socket, channels, fire } = fakeSocket();
    const presence = new ChatPresenceStore(socket, WS, ME);
    const release = presence.acquire();
    const ch = channels[0]!;
    expect([ch.topic, ch.opts]).toEqual([
      `chat:${WS}`,
      { config: { private: true, presence: { key: ME } } },
    ]);
    ch.status?.("SUBSCRIBED");
    expect(ch.tracked).toHaveLength(1);
    ch.presence = { [ME]: [{}], ana: [{}] };
    fire(ch, "presence", {}, "sync");
    expect(presence.getSnapshot()).toMatchObject({ status: "online", error: null });
    expect([...presence.getSnapshot().online].sort()).toEqual(["ana", ME]);
    release();
    expect(ch.removed).toBe(true);
  });

  it("held again while the last channel is still leaving: joins once it has left", async () => {
    const { socket, channels } = fakeSocket();
    const presence = new ChatPresenceStore(socket, WS, ME);
    presence.acquire()();
    const release = presence.acquire();
    // realtime-js would hand back the leaving channel: nothing joins yet.
    expect(channels).toHaveLength(1);
    await settle();
    expect(channels).toHaveLength(2);
    expect(channels[1]!.removed).toBe(false);
    release();
    expect(channels[1]!.removed).toBe(true);
  });

  it("a refused join shows as an error, never as everyone away (AC1.9)", () => {
    const { socket, channels } = fakeSocket();
    const presence = new ChatPresenceStore(socket, WS, ME);
    presence.acquire();
    channels[0]!.status?.("CHANNEL_ERROR");
    expect(presence.getSnapshot()).toMatchObject({
      status: "error",
      error: "Presence isn't available",
    });
  });
});
