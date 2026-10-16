import { describe, expect, it } from "@rstest/core";
import type { ChatChannel, ChatMessage } from "./model";
import {
  buildSidebar,
  buildStream,
  buildTimeline,
  channelTitle,
  countNewSince,
  isEmojiOnlyText,
  lastSeenMessage,
  localDay,
  mergeMessages,
  normalizeChannelName,
  type SidebarEntry,
  toggleReaction,
  upsertMessage,
  wrappedReplyIds,
} from "./timeline";

const ME = "me";
const YOU = "you";

function msg(id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    workspaceId: "w",
    channelId: "c",
    parentId: null,
    replyToId: null,
    kind: "message",
    event: null,
    formatVersion: 2,
    authorId: YOU,
    authorKind: "user",
    authorLabel: null,
    body: id,
    mentionedUserIds: [],
    mentionedTeamIds: [],
    mentionsEveryone: false,
    reactions: {},
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    wrappedAt: null,
    wrappedBy: null,
    settledId: null,
    reopenedAt: null,
    reopenedBy: null,
    pinnedAt: null,
    pinnedBy: null,
    editedAt: null,
    deletedAt: null,
    clientId: null,
    createdAt,
    updatedAt: createdAt,
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
    expect(normalizeChannelName(`${"-".repeat(50_000)}a${"-".repeat(50_000)}`)).toBe("a");
    expect(normalizeChannelName(`${"a".repeat(79)}-b`)).toBe(`${"a".repeat(79)}-`);
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
  });
});

// ── Chat v2's stream (CV-7a) ────────────────────────────────────────────────

describe("read mark, New pill, page boundaries", () => {
  const T = (min: number) => `2026-10-14T10:${String(min).padStart(2, "0")}:00Z`;

  it("draws a centred day separator per local day and starts a person after 5 minutes", () => {
    const rows = [
      msg("a", "2026-10-13T10:00:00Z"),
      msg("b", T(0)),
      msg("c", T(1)),
      msg("d", T(9)),
      msg("e", T(10), { authorId: ME }),
    ];
    const items = buildStream(rows);
    expect(items.map((i) => i.type)).toEqual([
      "day",
      "message",
      "day",
      "message",
      "message",
      "message",
      "message",
    ]);
    const firsts = items.flatMap((i) => (i.type === "message" ? [[i.key, i.first]] : []));
    expect(firsts).toEqual([
      ["a", true],
      ["b", true],
      ["c", false],
      ["d", true],
      ["e", true],
    ]);
    expect(items[0]).toMatchObject({ type: "day", key: `d:${localDay(rows[0]!.createdAt)}` });
  });

  it("the pill sits before the first unseen message from someone else, never on your own", () => {
    const rows = [
      msg("a", T(0)),
      msg("b", T(1)),
      msg("mine", T(2), { authorId: ME }),
      msg("c", T(3)),
      msg("d", T(4)),
    ];
    const items = buildStream(rows, { newAfter: { at: T(1), id: "b" }, selfId: ME });
    const keys = items.map((i) => i.key);
    expect(keys.indexOf("new")).toBe(keys.indexOf("c") - 1);
    expect(items[keys.indexOf("c")]).toMatchObject({ first: true });
    // Newer messages arriving later don't move it.
    const more = buildStream([...rows, msg("e", T(5))], {
      newAfter: { at: T(1), id: "b" },
      selfId: ME,
    });
    expect(more.map((i) => i.key).indexOf("new")).toBe(keys.indexOf("new"));
    // Nothing after the mark: no pill.
    expect(
      buildStream(rows, { newAfter: { at: T(4), id: "d" }, selfId: ME }).some(
        (i) => i.type === "new",
      ),
    ).toBe(false);
  });

  it("two messages with one timestamp both appear, once, and the pill splits them by id", () => {
    const at = "2026-10-14T10:00:00.123456Z";
    const rows = [msg("a1", at), msg("a2", at), msg("a2", at)];
    const items = buildStream(rows, { newAfter: { at, id: "a1" }, selfId: ME });
    expect(items.map((i) => i.key)).toEqual([`d:${localDay(at)}`, "a1", "new", "a2"]);
  });

  it("microseconds decide the mark inside one millisecond", () => {
    const rows = [msg("x", "2026-10-14T10:00:00.123400Z"), msg("y", "2026-10-14T10:00:00.123900Z")];
    const items = buildStream(rows, {
      newAfter: { at: "2026-10-14T10:00:00.123500Z", id: "zzz" },
      selfId: ME,
    });
    expect(items.map((i) => i.key).slice(1)).toEqual(["x", "new", "y"]);
  });

  it("the row past the window's edge sets grouping and the separator but isn't drawn", () => {
    const rows = [msg("edge", T(0)), msg("a", T(1)), msg("b", T(2))];
    const items = buildStream(rows, { hasOlder: true });
    expect(items.map((i) => i.key)).toEqual(["a", "b"]);
    expect(items[0]).toMatchObject({ first: false });
  });

  it("a deleted message without replies disappears; with replies it reads as deleted", () => {
    const rows = [
      msg("a", T(0), { deletedAt: T(5) }),
      msg("b", T(1), { deletedAt: T(5), replyCount: 2 }),
      msg("c", T(2)),
      msg("h", T(3)),
    ];
    const items = buildStream(rows, { hidden: new Set(["h"]) });
    expect(items.map((i) => [i.type, i.key])).toEqual([
      ["day", `d:${localDay(T(0))}`],
      ["deleted", "b"],
      ["message", "c"],
    ]);
    expect(items[2]).toMatchObject({ first: true });
  });

  it("event lines draw through their own row and break a person's run", () => {
    const rows = [
      msg("a", T(0)),
      msg("ev", T(1), { kind: "event", event: { type: "moved_out" }, authorId: null }),
      msg("b", T(2)),
    ];
    const items = buildStream(rows);
    expect(items.map((i) => i.type)).toEqual(["day", "message", "event", "message"]);
    expect(items[3]).toMatchObject({ first: true });
  });

  it("the mark moves to the last message on screen, skipping unsent sends and events", () => {
    const rows = [
      msg("a", T(0)),
      msg("b", T(1)),
      msg("ev", T(2), { kind: "event", authorId: null }),
      msg("s", T(3), { authorId: ME, sendState: "waiting" }),
    ];
    const items = buildStream(rows);
    expect(lastSeenMessage(items, items.length - 1)?.id).toBe("b");
    expect(lastSeenMessage(items, 1)?.id).toBe("a");
    expect(lastSeenMessage(items, 0)).toBeNull();
  });

  it("a reply converted into its root's chain reads with the stream by position", () => {
    const rows = [
      msg("root", T(0)),
      msg("reply", T(1), { parentId: "root", replyToId: "root" }),
      msg("later", T(2)),
    ];
    const items = buildStream(rows, { newAfter: { at: T(1), id: "reply" }, selfId: ME });
    expect(items.map((i) => i.key).slice(1)).toEqual(["root", "reply", "new", "later"]);
  });

  it("counts what arrived from others after the last row seen (the floating chip)", () => {
    const rows = [msg("a", T(0)), msg("b", T(1)), msg("m", T(2), { authorId: ME }), msg("c", T(3))];
    expect(countNewSince(rows, "a", ME)).toBe(2);
    expect(countNewSince(rows, "c", ME)).toBe(0);
    expect(countNewSince(rows, null, ME)).toBe(0);
  });

  it("emoji-only messages draw large", () => {
    expect(isEmojiOnlyText("🎉")).toBe(true);
    expect(isEmojiOnlyText("👍🏽 🇵🇱 👨‍👩‍👧")).toBe(true);
    expect(isEmojiOnlyText("", 1)).toBe(true);
    expect(isEmojiOnlyText("ok 🎉")).toBe(false);
    expect(isEmojiOnlyText("1")).toBe(false);
    expect(isEmojiOnlyText("🎉".repeat(9))).toBe(false);
  });
});

describe("wrapped chains in the stream (CV-12)", () => {
  const root = msg("r", "2026-10-01T10:00:00Z", { replyCount: 2 });
  const a = msg("a", "2026-10-01T10:01:00Z", { parentId: "r", replyToId: "r" });
  const talk = msg("t", "2026-10-01T10:02:00Z", { authorId: ME });
  const b = msg("b", "2026-10-01T10:03:00Z", { parentId: "r", replyToId: "a" });
  const ids = (items: ReturnType<typeof buildStream>) =>
    items.flatMap((i) => (i.type === "message" ? [i.key] : []));

  it("nothing folds automatically: an open chain's replies stay with the talk between them", () => {
    const rows = [root, a, talk, b];
    const hidden = wrappedReplyIds(rows, () => undefined);
    expect(ids(buildStream(rows, { hidden }))).toEqual(["r", "a", "t", "b"]);
  });

  it("hides the replies of a wrapped root, keeps the root, and joins the deletes", () => {
    const wrapped = { ...root, wrappedAt: "2026-10-01T11:00:00Z", settledId: "b" };
    const rows = [wrapped, a, talk, b];
    const hidden = wrappedReplyIds(rows, () => undefined, new Set(["t"]));
    expect([...hidden].sort()).toEqual(["a", "b", "t"]);
    expect(ids(buildStream(rows, { hidden }))).toEqual(["r"]);
  });

  it("reads a root outside the window from the store; an unknown root keeps its replies", () => {
    const wrapped = { ...root, wrappedAt: "2026-10-01T11:00:00Z" };
    const rows = [a, talk, b];
    expect([...wrappedReplyIds(rows, (id) => (id === "r" ? wrapped : undefined))]).toEqual([
      "a",
      "b",
    ]);
    expect(wrappedReplyIds(rows, () => undefined).size).toBe(0);
  });

  it("a reply after the wrap-up shows (it reopened the chain), and so do unsent ones", () => {
    const wrapped = { ...root, wrappedAt: "2026-10-01T10:02:30Z" };
    const unsent = msg("u", "2026-10-01T10:02:10Z", { parentId: "r", sendState: "sending" });
    const rows = [wrapped, a, talk, unsent, b];
    expect([...wrappedReplyIds(rows, () => undefined)]).toEqual(["a"]);
  });
});
