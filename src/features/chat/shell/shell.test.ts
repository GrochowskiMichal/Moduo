// CV-8a: the left panel's order and counts (spec §2), the line that replaces
// the composer (AC1.8, AC10.9, AC6.5, §1 paused), the Chat tab's rule and the
// rights a role reads.

import { describe, expect, it } from "@rstest/core";

import type { ChatChannel, ChatMember, ChatPerson, ChatUnread } from "../model";
import { EMPTY_CHAT_SNAPSHOT } from "../store/store";
import { chatTabShows } from "./chat-tab";
import { COMPOSER_LINE_COPY, composerLine, joinNames } from "./composer-state";
import { buildChatSidebar, sidebarOrder } from "./sidebar-model";
import { capsRoleKey, rightsFrom } from "./use-chat-rights";

const ME = "me";
const at = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;

function channel(id: string, patch: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id,
    workspaceId: "w",
    kind: "channel",
    name: id,
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: ME,
    createdAt: at(1),
    updatedAt: at(1),
    archivedAt: null,
    lastMessageAt: null,
    ...patch,
  };
}

function member(channelId: string, patch: Partial<ChatMember> = {}): ChatMember {
  return {
    channelId,
    userId: ME,
    workspaceId: "w",
    notifyLevel: "mentions",
    starred: false,
    lastReadAt: at(1),
    lastReadId: null,
    joinedAt: at(1),
    ...patch,
  };
}

function counts(channelId: string, unread: number, addressed: number): ChatUnread {
  return { channelId, unread, mentions: 0, addressed, catchup: addressed };
}

const PEOPLE: Record<string, ChatPerson> = {
  me: { userId: ME, name: "Alex Rivera", avatarUrl: null, role: null, former: false },
  so: { userId: "so", name: "Sofia Ortiz", avatarUrl: null, role: null, former: false },
  jl: { userId: "jl", name: "Jana Lis", avatarUrl: null, role: null, former: true },
};
const personOf = (id: string) => PEOPLE[id];

describe("the left panel (spec §2)", () => {
  const channels = {
    zeta: channel("zeta"),
    Acme: channel("Acme", { name: "Acme rebrand" }),
    random: channel("random", { name: "Random" }),
    pinned: channel("pinned", { name: "Launch v1" }),
    old: channel("old", { name: "Website 2025", archivedAt: at(5) }),
    other: channel("other", { name: "Hiring" }),
    dmOld: channel("dmOld", { kind: "dm", name: null, dmKey: "jl,me", lastMessageAt: at(2) }),
    dmNew: channel("dmNew", { kind: "dm", name: null, dmKey: "me,so", lastMessageAt: at(9) }),
  };
  const mine = {
    zeta: member("zeta"),
    Acme: member("Acme", { notifyLevel: "all" }),
    random: member("random", { notifyLevel: "none" }),
    pinned: member("pinned", { starred: true }),
    old: member("old"),
    dmOld: member("dmOld"),
    dmNew: member("dmNew"),
  };
  const unread = {
    Acme: counts("Acme", 3, 3),
    random: counts("random", 5, 2),
    zeta: counts("zeta", 4, 0),
    dmNew: counts("dmNew", 2, 2),
  };
  const model = buildChatSidebar({ channels, mine, unread, selfId: ME, personOf });

  it("orders Pinned, Channels alphabetically, Direct messages most recent first", () => {
    expect(model.pinned.map((r) => r.title)).toEqual(["Launch v1"]);
    expect(model.channels.map((r) => r.title)).toEqual(["Acme rebrand", "Random", "zeta"]);
    expect(model.dms.map((r) => r.title)).toEqual(["Sofia Ortiz", "Jana Lis"]);
  });

  it("keeps archived channels and ones you're not in out of the rows", () => {
    const rows = [...model.pinned, ...model.channels, ...model.dms].map((r) => r.channel.id);
    expect(rows).not.toContain("old");
    expect(rows).not.toContain("other");
    expect(model.archived.map((r) => r.title)).toEqual(["Website 2025"]);
  });

  it("makes unread bold and counts only what's addressed to you; Nothing never counts", () => {
    const by = (id: string) => [...model.channels, ...model.dms].find((r) => r.channel.id === id);
    expect(by("zeta")).toMatchObject({ unread: true, count: 0 });
    expect(by("Acme")).toMatchObject({ unread: true, count: 3 });
    expect(by("random")).toMatchObject({ unread: true, count: 0, muted: true });
    expect(by("dmNew")).toMatchObject({ unread: true, count: 2 });
    expect(model.catchup).toBe(5);
  });

  it("steps through the open sections only", () => {
    expect(sidebarOrder(model, new Set(["channels"])).map((r) => r.channel.id)).toEqual([
      "pinned",
      "dmNew",
      "dmOld",
    ]);
  });
});

describe("the line that replaces the composer (frame 7)", () => {
  const base = {
    selfId: ME,
    personOf,
    paused: false,
    isOwner: false,
    ownerName: "Anna",
    canPost: true,
    canManage: false,
  };
  const general = channel("general", { isDefault: true });

  it("is none for a member who may post", () => {
    expect(composerLine({ ...base, channel: general, member: member("general") })).toBeNull();
  });

  it("says the channel is archived, and offers Unarchive to its managers", () => {
    const archived = channel("a", { archivedAt: at(3) });
    expect(composerLine({ ...base, channel: archived, member: member("a") })).toEqual({
      kind: "archived",
      canUnarchive: false,
    });
    expect(
      composerLine({ ...base, canManage: true, channel: archived, member: member("a") }),
    ).toEqual({ kind: "archived", canUnarchive: true });
  });

  it("says chat is paused, naming the owner; the owner gets Choose a plan", () => {
    expect(
      composerLine({ ...base, paused: true, channel: general, member: member("general") }),
    ).toEqual({ kind: "paused", owner: false, ownerName: "Anna" });
    expect(
      composerLine({
        ...base,
        paused: true,
        isOwner: true,
        channel: general,
        member: member("general"),
      }),
    ).toMatchObject({ kind: "paused", owner: true });
  });

  it("gives a viewer a line, in channels and direct messages alike (AC10.9)", () => {
    const dm = channel("dm", { kind: "dm", dmKey: "me,so" });
    expect(composerLine({ ...base, canPost: false, channel: dm, member: member("dm") })).toEqual({
      kind: "viewer",
    });
    expect(COMPOSER_LINE_COPY.viewer).toBe("You can read this conversation but not post in it");
  });

  it("tells a non-manager in an announcement channel (AC1.8)", () => {
    const news = channel("news", { managersOnly: true });
    expect(composerLine({ ...base, channel: news, member: member("news") })).toEqual({
      kind: "announcement",
    });
    expect(
      composerLine({ ...base, canManage: true, channel: news, member: member("news") }),
    ).toBeNull();
  });

  it("says who left in a direct message with a former member (AC6.5)", () => {
    const dm = channel("dm", { kind: "dm", dmKey: "jl,me" });
    const line = composerLine({ ...base, channel: dm, member: member("dm") });
    expect(line).toEqual({ kind: "former", names: ["Jana Lis"] });
    expect(COMPOSER_LINE_COPY.former(["Jana Lis"])).toBe("Jana Lis left the workspace");
    const gone = channel("dm2", { kind: "dm", dmKey: "deleted,me" });
    expect(composerLine({ ...base, channel: gone, member: member("dm2") })).toEqual({
      kind: "former",
      names: ["Former member"],
    });
  });

  it("asks you to join a public channel you're not in", () => {
    expect(composerLine({ ...base, channel: general, member: undefined })).toEqual({
      kind: "join",
    });
  });

  it("joins names the way a sentence does", () => {
    expect(joinNames(["Jana"])).toBe("Jana");
    expect(joinNames(["Jana", "Tomek"])).toBe("Jana and Tomek");
    expect(joinNames(["Jana", "Tomek", "Ola"])).toBe("Jana, Tomek and Ola");
  });
});

describe("the Chat tab (spec §1)", () => {
  const ready = { ...EMPTY_CHAT_SNAPSHOT, status: "ready" as const };
  it("shows with two or more people, and while the member list loads", () => {
    expect(chatTabShows(2, ready)).toBe(true);
    expect(chatTabShows(0, ready)).toBe(true);
  });
  it("in a one-person workspace, only while chat history exists", () => {
    expect(chatTabShows(1, ready)).toBe(false);
    expect(
      chatTabShows(1, { ...ready, channels: { g: channel("g", { lastMessageAt: at(2) }) } }),
    ).toBe(true);
  });
});

describe("chat rights by role", () => {
  const rows = [
    { role_key: "admin", post: true, manage_any: true },
    { role_key: "member", post: true, manage_any: false },
    { role_key: "viewer", post: false, manage_any: false },
  ];
  it("reads the row the server reads", () => {
    expect(capsRoleKey("editor", false)).toBe("member");
    expect(capsRoleKey("editor", true)).toBe("viewer");
    expect(rightsFrom(rows, "viewer", false)).toEqual({ canPost: false, manageAny: false });
    expect(rightsFrom(rows, "admin", false)).toEqual({ canPost: true, manageAny: true });
    expect(rightsFrom(rows, "owner", false)).toEqual({ canPost: true, manageAny: true });
    expect(rightsFrom([{ role_key: "member", post: false }], "editor", false).canPost).toBe(false);
  });
  it("falls back to the role's usual rights before the rows arrive", () => {
    expect(rightsFrom(null, "viewer", false).canPost).toBe(false);
    expect(rightsFrom(null, "editor", false).canPost).toBe(true);
  });
});
