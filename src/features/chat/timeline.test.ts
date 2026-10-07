import { describe, expect, it } from "@rstest/core";
import type { ChatChannel, ChatMessage } from "./model";
import {
  badgeCount,
  buildSidebar,
  buildTimeline,
  channelTitle,
  mergeMessages,
  normalizeChannelName,
  type SidebarEntry,
  toggleReaction,
  upsertMessage,
} from "./timeline";

const ME = "me";
const YOU = "you";

function msg(id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    workspaceId: "w",
    channelId: "c",
    parentId: null,
    authorId: YOU,
    authorKind: "user",
    authorLabel: null,
    body: id,
    mentionedUserIds: [],
    reactions: {},
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    pinnedAt: null,
    pinnedBy: null,
    editedAt: null,
    deletedAt: null,
    clientId: null,
    createdAt,
    ...extra,
  };
}

function channel(id: string, extra: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id,
    workspaceId: "w",
    kind: "channel",
    name: id,
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    lastMessageAt: null,
    ...extra,
  };
}

describe("upsertMessage / mergeMessages", () => {
  it("replaces an optimistic row by clientId and re-sorts", () => {
    const optimistic = msg("tmp", "2026-10-06T10:00:05Z", {
      clientId: "k",
      pending: true,
      authorId: ME,
    });
    const list = [msg("a", "2026-10-06T10:00:00Z"), optimistic];
    const confirmed = msg("real", "2026-10-06T09:59:59Z", { clientId: "k", authorId: ME });
    const next = upsertMessage(list, confirmed);
    expect(next.map((m) => m.id)).toEqual(["real", "a"]);
    expect(next[0].pending).toBe(false);
  });

  it("appends in order and inserts out-of-order arrivals", () => {
    let list: ChatMessage[] = [];
    list = upsertMessage(list, msg("b", "2026-10-06T10:00:02Z"));
    list = upsertMessage(list, msg("a", "2026-10-06T10:00:01Z"));
    list = upsertMessage(list, msg("c", "2026-10-06T10:00:03Z"));
    expect(list.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("merges an older page without duplicates", () => {
    const list = [msg("b", "2026-10-06T10:00:02Z")];
    const page = [msg("b", "2026-10-06T10:00:02Z"), msg("a", "2026-10-06T10:00:01Z")];
    expect(mergeMessages(list, page).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("buildTimeline", () => {
  it("groups same-author messages within 5 minutes and splits days", () => {
    const rows = buildTimeline([
      msg("a", "2026-10-05T10:00:00Z"),
      msg("b", "2026-10-05T10:02:00Z"),
      msg("c", "2026-10-05T10:09:00Z"),
      msg("d", "2026-10-06T10:00:00Z"),
    ]);
    const shape = rows.map((r) =>
      r.kind === "message" ? `${r.message.id}${r.grouped ? "+" : ""}` : r.kind,
    );
    expect(shape).toEqual(["day", "a", "b+", "c", "day", "d"]);
  });

  it("places the New marker before the first unread from someone else", () => {
    const rows = buildTimeline(
      [
        msg("a", "2026-10-06T10:00:00Z"),
        msg("mine", "2026-10-06T10:01:00Z", { authorId: ME }),
        msg("b", "2026-10-06T10:02:00Z"),
      ],
      { lastReadAt: "2026-10-06T10:00:30Z", selfId: ME },
    );
    const shape = rows.map((r) => (r.kind === "message" ? r.message.id : r.kind));
    expect(shape).toEqual(["day", "a", "mine", "new", "b"]);
  });

  it("never groups two different apps together", () => {
    const app = (id: string, label: string, t: string) =>
      msg(id, t, { authorId: null, authorKind: "api_key", authorLabel: label });
    const rows = buildTimeline([
      app("a", "Claude", "2026-10-06T10:00:00Z"),
      app("b", "Claude", "2026-10-06T10:01:00Z"),
      app("c", "CI bot", "2026-10-06T10:02:00Z"),
    ]);
    expect(
      rows.filter((r) => r.kind === "message").map((r) => r.kind === "message" && r.grouped),
    ).toEqual([false, true, false]);
  });

  it("never groups under a thread root", () => {
    const rows = buildTimeline([
      msg("root", "2026-10-06T10:00:00Z", { replyCount: 2 }),
      msg("next", "2026-10-06T10:01:00Z"),
    ]);
    expect(
      rows.filter((r) => r.kind === "message").map((r) => r.kind === "message" && r.grouped),
    ).toEqual([false, false]);
  });
});

describe("reactions", () => {
  it("toggles on and off, dropping empty emoji", () => {
    const on = toggleReaction({}, "🎉", ME);
    expect(on).toEqual({ "🎉": [ME] });
    expect(toggleReaction(on, "🎉", ME)).toEqual({});
    expect(toggleReaction({ "🎉": [YOU] }, "🎉", ME)).toEqual({ "🎉": [YOU, ME] });
  });
});

describe("channels", () => {
  it("normalizes names like the SQL op", () => {
    expect(normalizeChannelName("  Design Crit Ñandú! ")).toBe("design-crit-ñandú");
    expect(normalizeChannelName("--a  b--")).toBe("a-b");
    expect(normalizeChannelName("!!!")).toBe("");
  });

  it("titles DMs by the other people, and a self-DM as you", () => {
    const people = new Map([
      [ME, { userId: ME, name: "Mike", avatarUrl: null, role: null }],
      [YOU, { userId: YOU, name: "Maciej", avatarUrl: null, role: null }],
    ]);
    const personOf = (id: string) => people.get(id);
    expect(
      channelTitle(channel("d", { kind: "dm", name: null, dmKey: `${ME},${YOU}` }), ME, personOf),
    ).toBe("Maciej");
    expect(channelTitle(channel("s", { kind: "dm", name: null, dmKey: ME }), ME, personOf)).toBe(
      "Mike (you)",
    );
  });

  it("sorts the sidebar and computes a quiet badge", () => {
    const e = (c: ChatChannel, x: Partial<SidebarEntry> = {}): SidebarEntry => ({
      channel: c,
      unread: 0,
      mentions: 0,
      starred: false,
      muted: false,
      isMember: true,
      ...x,
    });
    const entries = [
      e(channel("zeta"), { unread: 4 }),
      e(channel("alpha"), { unread: 2, mentions: 1 }),
      e(channel("star"), { starred: true }),
      e(channel("old", { archivedAt: "2026-01-02T00:00:00Z" })),
      e(channel("notjoined"), { isMember: false }),
      e(
        channel("dm1", {
          kind: "dm",
          name: null,
          dmKey: "x",
          lastMessageAt: "2026-10-01T00:00:00Z",
        }),
        { unread: 3 },
      ),
      e(
        channel("dm2", {
          kind: "dm",
          name: null,
          dmKey: "y",
          lastMessageAt: "2026-10-05T00:00:00Z",
        }),
      ),
      e(channel("muted"), { unread: 9, mentions: 9, muted: true }),
    ];
    const s = buildSidebar(entries, (c) => c.name ?? c.id);
    expect(s.starred.map((x) => x.channel.id)).toEqual(["star"]);
    expect(s.channels.map((x) => x.channel.id)).toEqual(["alpha", "muted", "zeta"]);
    expect(s.dms.map((x) => x.channel.id)).toEqual(["dm2", "dm1"]);
    // alpha: 1 mention (default level), zeta: 0 mentions, dm1: 3 unread, muted: 0.
    expect(badgeCount(entries, () => "mentions")).toBe(4);
  });
});
