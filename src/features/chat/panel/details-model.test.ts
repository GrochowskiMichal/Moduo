// Chat's right panel and dialogs, the pure half (CV-8b, spec §12): who Details
// lists and in what order, what Browse channels offers, what New conversation
// may send, and the message in context's read.

import { describe, expect, it } from "@rstest/core";

import type { ChatChannel, ChatMember, ChatMessage, ChatPerson, ChatRuntime } from "../model";
import {
  browseChannels,
  channelNameProblem,
  detailsPeople,
  detailsStamp,
  dmIntent,
  pickable,
} from "./details-model";
import { readInContext } from "./message-in-context";

const person = (userId: string, name: string, former = false): ChatPerson => ({
  userId,
  name,
  avatarUrl: null,
  role: null,
  former,
});

const channel = (id: string, over: Partial<ChatChannel> = {}): ChatChannel => ({
  id,
  workspaceId: "ws",
  kind: "channel",
  name: id,
  topic: "",
  isPrivate: false,
  dmKey: null,
  createdBy: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  archivedAt: null,
  lastMessageAt: null,
  ...over,
});

const member = (channelId: string, userId = "me"): ChatMember => ({
  channelId,
  userId,
  workspaceId: "ws",
  notifyLevel: "mentions",
  starred: false,
  lastReadAt: "2026-10-01T10:00:00.000Z",
  lastReadId: null,
  joinedAt: "2026-10-01T10:00:00.000Z",
});

describe("Details' people (frame 4)", () => {
  const people: Record<string, ChatPerson> = {
    me: person("me", "Zofia"),
    a: person("a", "Bartek"),
    b: person("b", "Anna"),
    gone: person("gone", "Jana", true),
  };
  it("lists you first, then everyone by name, with presence and former members kept", () => {
    const rows = detailsPeople(
      ["a", "gone", "me", "b", "a", "unknown"].map((id) => member("c", id)),
      "me",
      (id) => people[id],
      (id) => id === "a",
    );
    expect(rows.map((r) => r.name)).toEqual(["Zofia", "Anna", "Bartek", "Former member", "Jana"]);
    expect(rows[0]).toMatchObject({ self: true, online: true });
    expect(rows.find((r) => r.userId === "a")?.online).toBe(true);
    expect(rows.find((r) => r.userId === "b")?.online).toBe(false);
    expect(rows.find((r) => r.userId === "gone")?.former).toBe(true);
    expect(rows.find((r) => r.userId === "unknown")?.former).toBe(true);
  });
});

describe("Browse channels (frame 3)", () => {
  it("lists public channels by name, Join or Open, then Archived; never private ones or DMs", () => {
    const channels = {
      zeta: channel("zeta"),
      alpha: channel("alpha", { topic: "Launch" }),
      secret: channel("secret", { isPrivate: true }),
      dm: channel("dm", { kind: "dm", name: null }),
      old: channel("old", { archivedAt: "2026-09-30T10:00:00.000Z" }),
    };
    const { open, archived } = browseChannels(channels, { zeta: member("zeta") });
    expect(open.map((r) => [r.channel.id, r.joined])).toEqual([
      ["alpha", false],
      ["zeta", true],
    ]);
    expect(archived.map((r) => r.channel.id)).toEqual(["old"]);
  });
});

describe("New conversation (frame 3)", () => {
  it("takes a channel name as typed, 1–80 characters", () => {
    expect(channelNameProblem("  ")).toBe("Give the channel a name.");
    expect(channelNameProblem("Launch v1")).toBeNull();
    expect(channelNameProblem("x".repeat(81))).toMatch(/80/);
  });

  it("offers a note for only yourself, opens up to eight others, refuses more", () => {
    expect(dmIntent([], "me")).toEqual({ kind: "empty" });
    expect(dmIntent(["me"], "me")).toEqual({ kind: "self" });
    expect(dmIntent(["me", "a", "a"], "me")).toEqual({ kind: "open", userIds: ["a"] });
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}`);
    expect(dmIntent(nine, "me")).toEqual({ kind: "too-many" });
    expect(dmIntent(nine.slice(0, 8), "me").kind).toBe("open");
  });

  it("finds people by name who aren't picked yet, never former members", () => {
    const all = [person("a", "Anna"), person("b", "Bartek"), person("j", "Jana", true)];
    expect(pickable(all, [], "").map((p) => p.userId)).toEqual(["a", "b"]);
    expect(pickable(all, ["a"], "").map((p) => p.userId)).toEqual(["b"]);
    expect(pickable(all, [], "bar").map((p) => p.userId)).toEqual(["b"]);
    expect(pickable(all, [], "jan")).toEqual([]);
  });
});

describe("a message in context (spec #10)", () => {
  const msg = (n: number, over: Partial<ChatMessage> = {}): ChatMessage =>
    ({
      id: `m${n}`,
      channelId: "c",
      kind: "message",
      deletedAt: null,
      createdAt: `2026-10-01T10:${String(n).padStart(2, "0")}:00.000Z`,
      ...over,
    }) as ChatMessage;

  it("reads ten either side around the message, without moving the open window", async () => {
    const calls: unknown[] = [];
    const chat = {
      message: async (id: string) => ({ data: msg(Number(id.slice(1))), error: null }),
      page: async (args: { before?: unknown; after?: unknown; limit: number }) => {
        calls.push(args);
        return args.before
          ? { data: [msg(18), msg(19, { kind: "event" })], error: null }
          : { data: [msg(21), msg(22, { deletedAt: "x" })], error: null };
      },
    } as unknown as Pick<ChatRuntime, "message" | "page">;
    const rows = await readInContext(chat, "m20");
    expect(rows?.map((m) => m.id)).toEqual(["m18", "m20", "m21"]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => (c as { limit: number }).limit === 10)).toBe(true);
  });

  it("says the message isn't there when it can't be read", async () => {
    const chat = {
      message: async () => ({ data: null, error: { code: "42501", message: "no" } }),
      page: async () => ({ data: [], error: null }),
    } as unknown as Pick<ChatRuntime, "message" | "page">;
    expect(await readInContext(chat, "m1")).toBeNull();
  });
});

describe("when Details reads again", () => {
  const row = (id: string, over: Partial<ChatMessage> = {}) =>
    ({
      id,
      kind: "message",
      pinnedAt: null,
      editedAt: null,
      deletedAt: null,
      ...over,
    }) as ChatMessage;
  it("never for a plain new message; for a pin, an edit, a delete or an event line", () => {
    const base = [row("a"), row("b")];
    expect(detailsStamp([...base, row("c")])).toBe(detailsStamp(base));
    expect(detailsStamp([...base, row("c", { pinnedAt: "t" })])).not.toBe(detailsStamp(base));
    expect(detailsStamp([...base, row("c", { editedAt: "t" })])).not.toBe(detailsStamp(base));
    expect(detailsStamp([...base, row("c", { kind: "event" })])).not.toBe(detailsStamp(base));
  });
});
