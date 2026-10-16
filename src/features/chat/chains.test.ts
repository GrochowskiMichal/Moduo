import { describe, expect, it } from "@rstest/core";
import {
  type ChainRights,
  chainGroups,
  chainsStamp,
  mayAttach,
  mayWrap,
  replyToChoices,
} from "./chains";

import type { ChatMessage } from "./model";
import { message } from "./store/testing";

const ME = "me";
const SOFIA = "sofia";
const JANA = "jana";

const m = (id: string, at: string, extra: Partial<ChatMessage> = {}) =>
  message(id, "c", at, { updatedAt: at, authorId: SOFIA, ...extra });

const member: ChainRights = { canPost: true, paused: false, canManage: false, selfId: ME };
const channel = { kind: "channel" as const, archivedAt: null };

describe("who may wrap up and Reply to… (§12)", () => {
  const mine = m("r1", "2026-10-01T10:00:00Z", { authorId: ME, replyCount: 2 });
  const theirs = m("r2", "2026-10-01T10:00:00Z", { replyCount: 2 });

  it("wrap up: the root's author, managers and admins; in a DM anyone who can post", () => {
    expect(mayWrap(mine, channel, member)).toBe(true);
    expect(mayWrap(theirs, channel, member)).toBe(false);
    expect(mayWrap(theirs, channel, { ...member, canManage: true })).toBe(true);
    expect(mayWrap(theirs, { kind: "dm", archivedAt: null }, member)).toBe(true);
  });

  it("a manager or admin outside a public channel may still wrap up and attach others'", () => {
    const outside: ChainRights = { ...member, canPost: true, canManage: true };
    expect(mayWrap(theirs, channel, outside)).toBe(true);
    expect(mayAttach(m("b", "2026-10-01T10:00:00Z"), channel, outside)).toBe(true);
    // A manager whose role can't post (a viewer now) can't: the server asks for it.
    const noPost: ChainRights = { ...outside, canPost: false };
    expect(mayWrap(theirs, channel, noPost)).toBe(false);
    expect(mayAttach(m("b", "2026-10-01T10:00:00Z"), channel, noPost)).toBe(false);
    expect(mayWrap(theirs, channel, { ...outside, paused: true })).toBe(false);
    expect(mayWrap(theirs, { ...channel, archivedAt: "x" }, outside)).toBe(false);
  });

  it("never for a viewer, on a paused plan or in an archived channel", () => {
    expect(mayWrap(mine, channel, { ...member, canPost: false })).toBe(false);
    expect(mayWrap(mine, channel, { ...member, paused: true })).toBe(false);
    expect(mayWrap(mine, { ...channel, archivedAt: "2026-10-02T00:00:00Z" }, member)).toBe(false);
    expect(mayWrap(theirs, { kind: "dm", archivedAt: null }, { ...member, canPost: false })).toBe(
      false,
    );
  });

  it("Reply to…: your own message, anyone's for managers; never a message with replies", () => {
    const own = m("a", "2026-10-01T10:00:00Z", { authorId: ME });
    const other = m("b", "2026-10-01T10:00:00Z");
    expect(mayAttach(own, channel, member)).toBe(true);
    expect(mayAttach(other, channel, member)).toBe(false);
    expect(mayAttach(other, channel, { ...member, canManage: true })).toBe(true);
    expect(mayAttach({ ...own, replyCount: 1 }, channel, member)).toBe(false);
    expect(mayAttach(own, channel, { ...member, canPost: false })).toBe(false);
    expect(mayAttach(own, channel, { ...member, paused: true })).toBe(false);
  });

  it("Reply to… lists only earlier messages, open chains first", () => {
    const first = m("1", "2026-10-01T09:00:00Z");
    const chain = m("2", "2026-10-01T09:30:00Z", { replyCount: 2 });
    const done = m("3", "2026-10-01T09:40:00Z", { replyCount: 1, wrappedAt: "x" });
    const gone = m("4", "2026-10-01T09:50:00Z", { deletedAt: "x" });
    const stray = m("5", "2026-10-01T10:00:00Z", { authorId: ME });
    const later = m("6", "2026-10-01T11:00:00Z");
    const ids = replyToChoices(stray, [first, chain, done, gone, stray, later]).map((x) => x.id);
    expect(ids).toEqual(["2", "3", "1"]);
  });
});

describe("the Reply chains view (frame 4 list)", () => {
  const older = m("old", "2026-10-01T09:00:00Z", {
    replyCount: 2,
    lastReplyAt: "2026-10-01T11:30:00Z",
    replyUserIds: [ME],
  });
  const newer = m("new", "2026-10-01T10:00:00Z", {
    replyCount: 4,
    lastReplyAt: "2026-10-01T14:40:00Z",
    replyUserIds: [JANA, ME],
  });
  const wrapped = m("wr", "2026-10-01T08:00:00Z", {
    replyCount: 3,
    lastReplyAt: "2026-10-01T15:00:00Z",
    wrappedAt: "2026-10-01T15:10:00Z",
    replyUserIds: [JANA],
  });

  it("open chains newest activity first, then the wrapped ones", () => {
    const g = chainGroups([older, wrapped, newer], {
      selfId: ME,
      lastReadAt: null,
      repliesOf: () => [],
    });
    expect(g.open.map((e) => e.root.id)).toEqual(["new", "old"]);
    expect(g.wrapped.map((e) => e.root.id)).toEqual(["wr"]);
  });

  it("counts held replies from others after your read mark as new", () => {
    const replies = [
      m("x1", "2026-10-01T12:00:00Z", { parentId: "new", authorId: JANA }),
      m("x2", "2026-10-01T13:00:00Z", { parentId: "new", authorId: ME }),
      m("x3", "2026-10-01T14:40:00Z", { parentId: "new", authorId: JANA }),
      m("x0", "2026-10-01T10:30:00Z", { parentId: "new", authorId: JANA }),
    ];
    const g = chainGroups([newer, older], {
      selfId: ME,
      lastReadAt: "2026-10-01T11:00:00Z",
      repliesOf: (id) => (id === "new" ? replies : []),
    });
    expect(g.open.map((e) => [e.root.id, e.fresh])).toEqual([
      ["new", 2],
      // Your own last reply is never new.
      ["old", 0],
    ]);
  });

  it("says 1 new when nothing is held but someone else replied after your mark", () => {
    const g = chainGroups([newer], {
      selfId: ME,
      lastReadAt: "2026-10-01T12:00:00Z",
      repliesOf: () => [],
    });
    expect(g.open[0]?.fresh).toBe(1);
  });

  it("re-reads only when chains change, not on a plain message", () => {
    const plain = m("p", "2026-10-01T16:00:00Z");
    expect(chainsStamp([older, newer])).toBe(chainsStamp([older, newer, plain]));
    expect(chainsStamp([older, newer])).not.toBe(chainsStamp([older, { ...newer, replyCount: 5 }]));
    expect(chainsStamp([older])).not.toBe(chainsStamp([{ ...older, wrappedAt: "x" }]));
  });
});
