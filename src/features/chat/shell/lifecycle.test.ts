// CV-15: who manages a channel on the client (rule: someone demoted loses the
// controls at once), the announcement line follows real managers, the
// make-private words (#33), Recently deleted's days, the role editor's chat
// rows, and the rows the server sends for the lifecycle.

import { describe, expect, it } from "@rstest/core";

import { chatCapsKey, visibleRights } from "../../settings/access/chat-rights-section";
import { daysLeft, makePrivateCopy } from "../dialogs/channel-dialogs";
import { mapChannel, mapDeletedChannel, mapMember, mapMessage } from "../mappers";
import type { ChatChannel, ChatMember, ChatMessage } from "../model";
import { composerLine, newestPost } from "./composer-state";
import { managesChannel } from "./use-chat-rights";

const ME = "me";
const member = { canPost: true, manageAny: false };
const admin = { canPost: true, manageAny: true };
const viewer = { canPost: false, manageAny: false };

describe("managesChannel: a manager in effect, or an admin (rule 1)", () => {
  it("a manager row in the channel with a role that posts manages it", () => {
    expect(managesChannel({ selfId: ME, managers: [ME], inChannel: true, rights: member })).toEqual(
      { canManage: true, isManager: true },
    );
  });

  it("removed as manager: the controls go", () => {
    expect(
      managesChannel({ selfId: ME, managers: ["so"], inChannel: true, rights: member }),
    ).toEqual({ canManage: false, isManager: false });
  });

  it("their role became viewer: the stale row manages nothing", () => {
    expect(managesChannel({ selfId: ME, managers: [ME], inChannel: true, rights: viewer })).toEqual(
      { canManage: false, isManager: false },
    );
  });

  it("left the channel: the row manages nothing", () => {
    expect(
      managesChannel({ selfId: ME, managers: [ME], inChannel: false, rights: member }).canManage,
    ).toBe(false);
  });

  it("an admin manages without a row but isn't one of its managers", () => {
    expect(managesChannel({ selfId: ME, managers: [], inChannel: true, rights: admin })).toEqual({
      canManage: true,
      isManager: false,
    });
    expect(
      managesChannel({ selfId: ME, managers: null, inChannel: false, rights: admin }).canManage,
    ).toBe(true);
  });
});

describe("the announcement line follows the channel's managers (AC10.4)", () => {
  const news: ChatChannel = {
    id: "news",
    workspaceId: "w",
    kind: "channel",
    name: "news",
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: "so",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    archivedAt: null,
    lastMessageAt: null,
    managersOnly: true,
  };
  const mine: ChatMember = {
    channelId: "news",
    userId: ME,
    workspaceId: "w",
    notifyLevel: "mentions",
    starred: false,
    lastReadAt: "2026-10-01T10:00:00.000Z",
    lastReadId: null,
    joinedAt: "2026-10-01T10:00:00.000Z",
  };
  const base = {
    channel: news,
    member: mine,
    selfId: ME,
    personOf: () => undefined,
    paused: false,
    isOwner: false,
    ownerName: null,
    canPost: true,
  };

  it("an admin who isn't one of its managers gets the line (the server refuses their post)", () => {
    expect(composerLine({ ...base, canManage: true, isManager: false })).toEqual({
      kind: "announcement",
    });
  });

  it("one of its managers gets the composer", () => {
    expect(composerLine({ ...base, canManage: true, isManager: true })).toBeNull();
  });
});

describe("the make-private confirm and Recently deleted", () => {
  it("says it once, with who stays (#33)", () => {
    expect(makePrivateCopy("Founders", 4)).toEqual({
      title: "Make Founders private?",
      body: "It can't go back to public. 4 people stay in it.",
    });
    expect(makePrivateCopy("Duo", 1).body).toBe(
      "It can't go back to public. 1 person stays in it.",
    );
  });

  it("counts the days left before the purge", () => {
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    expect(daysLeft("2026-11-15T12:00:00.000Z", now)).toBe(30);
    expect(daysLeft("2026-10-16T18:00:00.000Z", now)).toBe(1);
    expect(daysLeft("2026-10-16T06:00:00.000Z", now)).toBe(0);
  });
});

describe("the role editor's chat rows (AC1.12)", () => {
  it("maps a role to the caps row the server reads", () => {
    expect(chatCapsKey("admin", false)).toBe("admin");
    expect(chatCapsKey("member", false)).toBe("member");
    expect(chatCapsKey("viewer", false)).toBe("viewer");
    expect(chatCapsKey(null, false)).toBe("member");
    expect(chatCapsKey(null, true)).toBe("viewer");
  });

  it("reads Manage any channel, hides Start calls, shows Add custom emoji only once it exists", () => {
    const row = {
      role_key: "member",
      post: true,
      mention_everyone: true,
      create_public: true,
      create_private: true,
      delete_others: false,
      manage_any: false,
      start_calls: true,
    };
    const keys = visibleRights(row).map((r) => r.key);
    expect(keys).toContain("manage_any");
    expect(keys).not.toContain("start_calls");
    expect(keys).not.toContain("add_emoji");
    expect(visibleRights({ ...row, add_emoji: true }).map((r) => r.key)).toContain("add_emoji");
  });
});

describe("the lifecycle's rows", () => {
  it("reads a channel's roster stamp and a membership's access stamp", () => {
    expect(
      mapChannel({ id: "c", workspace_id: "w", kind: "channel", name: "x", roster_at: "t1" })
        ?.rosterAt,
    ).toBe("t1");
    expect(
      mapMember({ channel_id: "c", user_id: ME, workspace_id: "w", access_at: "t2" })?.accessAt,
    ).toBe("t2");
  });

  it("reads a Recently deleted row", () => {
    expect(
      mapDeletedChannel({
        id: "c",
        name: "Launch",
        is_private: true,
        deleted_at: "2026-10-01T00:00:00Z",
        deleted_by: "so",
        purge_at: "2026-10-31T00:00:00Z",
      }),
    ).toEqual({
      id: "c",
      name: "Launch",
      isPrivate: true,
      deletedAt: "2026-10-01T00:00:00Z",
      deletedBy: "so",
      purgeAt: "2026-10-31T00:00:00Z",
    });
    expect(mapDeletedChannel({ id: "c" })).toBeNull();
  });
});

describe("Reply privately from the announcement line (CH50, AC5.5)", () => {
  const msg = (id: string, patch: Record<string, unknown> = {}): ChatMessage => {
    const m = mapMessage({
      id,
      workspace_id: "w",
      channel_id: "news",
      author_id: "so",
      author_kind: "user",
      kind: "message",
      body: "Launch is Thursday",
      created_at: "2026-10-01T10:00:00.000Z",
      updated_at: "2026-10-01T10:00:00.000Z",
      ...patch,
    });
    if (!m) throw new Error("bad row");
    return m;
  };

  it("answers the newest post by someone else, never a reply, an app's post, a deleted one or your own", () => {
    const rows = [
      msg("a"),
      msg("b", { author_id: "mi" }),
      msg("reply", { parent_id: "b" }),
      msg("app", { author_kind: "api_key", author_id: null }),
      msg("gone", { deleted_at: "2026-10-01T11:00:00.000Z" }),
      msg("mine", { author_id: ME }),
    ];
    expect(newestPost(rows, ME)?.id).toBe("b");
    expect(newestPost([msg("mine", { author_id: ME })], ME)).toBeNull();
    expect(newestPost(undefined, ME)).toBeNull();
  });
});
