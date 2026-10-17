import { describe, expect, it } from "@rstest/core";

import type { ChatCatchupItem, ChatChannel, ChatMessage, ChatPerson } from "../model";
import { shapeCatchupWidget } from "./widget";

const ME = "me";
const SOFIA = "sofia";

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
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    archivedAt: null,
    lastMessageAt: null,
    ...extra,
  };
}

function item(
  id: string,
  channelId: string,
  reason: ChatCatchupItem["reason"],
  minute: number,
  extra: Partial<ChatCatchupItem> = {},
): ChatCatchupItem {
  const at = new Date(Date.UTC(2026, 9, 16, 9, minute)).toISOString();
  return {
    id,
    channelId,
    messageId: `m-${id}`,
    chainRootId: null,
    reason,
    actorId: null,
    createdAt: at,
    laterUntil: null,
    returnedAt: null,
    at,
    ...extra,
  };
}

function message(id: string, authorId: string): ChatMessage {
  return { id, authorId, authorKind: "user", authorLabel: null } as ChatMessage;
}

const PEOPLE: Record<string, ChatPerson> = {
  [ME]: { userId: ME, name: "Alex", avatarUrl: null, role: "member" },
  [SOFIA]: { userId: SOFIA, name: "Sofia", avatarUrl: null, role: "member" },
};
const CHANNELS = {
  acme: channel("acme"),
  dm: channel("dm", { kind: "dm", name: null, dmKey: `${ME},${SOFIA}` }),
};

describe("Catch up widget (AC11.6, AC15.2)", () => {
  const items = [
    item("a", "acme", "mention", 1),
    item("b", "dm", "dm", 3),
    item("c", "acme", "added", 2, { messageId: null, actorId: SOFIA }),
  ];
  const messages = { "m-a": message("m-a", SOFIA), "m-b": message("m-b", SOFIA) };

  it("lists what's waiting, newest first, in the Catch up list's words (frame 8)", () => {
    const view = shapeCatchupWidget({
      items,
      messages,
      channels: CHANNELS,
      unread: {},
      people: PEOPLE,
      selfId: ME,
      limit: 5,
    });
    expect(view.rows.map((r) => [r.who, r.line])).toEqual([
      ["Sofia", "sent you a message"],
      ["Sofia", "added you to acme"],
      ["Sofia", "mentioned you · acme"],
    ]);
    expect(view.rows[0]!.whoId).toBe(SOFIA);
    // Quiet lines are listed, never counted.
    expect(view.count).toBe(2);
    expect(view.more).toBe(0);
  });

  it("keeps to its row budget and says how many more", () => {
    const view = shapeCatchupWidget({
      items,
      messages,
      channels: CHANNELS,
      unread: {},
      people: PEOPLE,
      selfId: ME,
      limit: 1,
    });
    expect(view.rows).toHaveLength(1);
    expect(view.more).toBe(2);
  });

  it("names nobody it can't read: an item whose message isn't held has no author", () => {
    const view = shapeCatchupWidget({
      items: [item("x", "acme", "mention", 1)],
      messages: {},
      channels: CHANNELS,
      unread: {},
      people: PEOPLE,
      selfId: ME,
      limit: 5,
    });
    expect(view.rows[0]).toMatchObject({ who: null, whoId: null, line: "mentioned you · acme" });
  });

  it("is empty when nothing waits", () => {
    expect(
      shapeCatchupWidget({
        items: [],
        messages: {},
        channels: CHANNELS,
        unread: {},
        people: PEOPLE,
        selfId: ME,
        limit: 5,
      }),
    ).toEqual({ rows: [], count: 0, more: 0 });
  });
});
