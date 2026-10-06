import { describe, expect, it } from "vitest";
import type { ChatChannel, ChatMember } from "./model";
import { shapeChatWidget } from "./widget";

const ME = "me";
const c = (id: string, extra: Partial<ChatChannel> = {}): ChatChannel => ({
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
  lastMessageAt: "2026-10-01T00:00:00Z",
  ...extra,
});
const m = (channelId: string, notifyLevel: ChatMember["notifyLevel"] = "mentions"): ChatMember => ({
  channelId,
  userId: ME,
  workspaceId: "w",
  notifyLevel,
  starred: false,
  lastReadAt: "2026-01-01T00:00:00Z",
  joinedAt: "2026-01-01T00:00:00Z",
});

describe("shapeChatWidget", () => {
  it("puts what needs you first and hides muted / archived / not-joined", () => {
    const view = shapeChatWidget({
      channels: [
        c("quiet", { lastMessageAt: "2026-10-05T00:00:00Z" }),
        c("busy", { lastMessageAt: "2026-10-04T00:00:00Z" }),
        c("dm", {
          kind: "dm",
          name: null,
          dmKey: `${ME},ana`,
          lastMessageAt: "2026-10-02T00:00:00Z",
        }),
        c("muted"),
        c("old", { archivedAt: "2026-02-01T00:00:00Z" }),
        c("stranger"),
      ],
      mine: [m("quiet"), m("busy"), m("dm"), m("muted", "none"), m("old")],
      unread: [
        { channelId: "busy", unread: 5, mentions: 0 },
        { channelId: "dm", unread: 2, mentions: 0 },
        { channelId: "muted", unread: 9, mentions: 9 },
      ],
      people: { ana: { userId: "ana", name: "Ana", avatarUrl: null, role: null } },
      selfId: ME,
      limit: 10,
    });
    expect(view.rows.map((r) => r.channelId)).toEqual(["dm", "busy", "quiet"]);
    expect(view.rows[0]?.title).toBe("Ana");
    // busy has 5 unread but no mentions → weight only, no count.
    expect(view.rows[1]?.count).toBe(0);
    expect(view.needsYou).toBe(2);
  });
});
