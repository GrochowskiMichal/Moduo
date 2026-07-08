// Proves AC10 — notifications group by target then verb (digest-default, no
// per-event card), unread/read derive from the read mark, and the card renders a
// human sentence with a deep-link, never raw JSON.

import { describe, expect, it } from "vitest";

import {
  groupNotifications,
  notificationDeepLink,
  notificationSummary,
  unreadCount,
  type NotificationItem,
} from "./notifications";

function item(over: Partial<NotificationItem> & Pick<NotificationItem, "id" | "createdAt">): NotificationItem {
  return {
    source: "spine",
    workspaceId: "w1",
    targetType: "task",
    targetId: "t1",
    op: "comments.add",
    payload: {},
    actorType: "user",
    actorId: "u2",
    actorLabel: "Mike",
    readAt: null,
    ...over,
  };
}

describe("groupNotifications", () => {
  it("collapses N rows on the same target+verb into one card with a count", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-06-26T10:00:00Z", payload: { excerpt: "first" } }),
      item({ id: "b", createdAt: "2026-06-26T11:00:00Z", actorId: "u3", actorLabel: "Ola", payload: { excerpt: "second" } }),
      item({ id: "c", createdAt: "2026-06-26T12:00:00Z", payload: { excerpt: "third" } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].actorIds).toEqual(["u2", "u3"]);
    // newest event drives the card timestamp.
    expect(groups[0].latestAt).toBe("2026-06-26T12:00:00Z");
  });

  it("separates different verbs and different targets into their own cards", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-06-26T10:00:00Z", op: "comments.add" }),
      item({ id: "b", createdAt: "2026-06-26T11:00:00Z", op: "links.create" }),
      item({ id: "c", createdAt: "2026-06-26T12:00:00Z", targetId: "t2", op: "comments.add" }),
    ]);
    expect(groups).toHaveLength(3);
    // sorted newest-first by the group's latest event.
    expect(groups.map((g) => g.targetId)).toEqual(["t2", "t1", "t1"]);
  });

  it("derives unread/read from the read mark", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-06-26T10:00:00Z", readAt: null }),
      item({ id: "b", createdAt: "2026-06-26T11:00:00Z", readAt: "2026-06-26T11:05:00Z" }),
    ]);
    expect(groups[0].count).toBe(2);
    expect(groups[0].unreadCount).toBe(1);
  });
});

describe("unreadCount", () => {
  it("counts only rows without a read mark", () => {
    expect(
      unreadCount([
        item({ id: "a", createdAt: "2026-06-26T10:00:00Z", readAt: null }),
        item({ id: "b", createdAt: "2026-06-26T11:00:00Z", readAt: "x" }),
        item({ id: "c", createdAt: "2026-06-26T12:00:00Z", readAt: null }),
      ]),
    ).toBe(2);
  });
});

describe("notificationSummary", () => {
  it("renders a human sentence, attributing the latest actor + others", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-06-26T10:00:00Z", actorId: "u2", actorLabel: "Mike", payload: { excerpt: "hi" } }),
      item({ id: "b", createdAt: "2026-06-26T12:00:00Z", actorId: "u3", actorLabel: "Ola", payload: { excerpt: "yo" } }),
    ]);
    expect(notificationSummary(groups[0], "me")).toBe("Ola and 1 other commented: “yo”");
  });

  it("says You for the current user's own latest action", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-06-26T10:00:00Z", actorId: "me", op: "links.create", payload: { relation_kind: "follow-up" } }),
    ]);
    expect(notificationSummary(groups[0], "me")).toBe("You added a follow-up");
  });

  it("humanizes a legacy/unknown event type instead of showing it raw", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-06-26T10:00:00Z", op: "note_shared", actorLabel: "Mike", actorId: "u2" }),
    ]);
    expect(notificationSummary(groups[0], "me")).toBe("Mike note shared");
  });
});

describe("notificationDeepLink", () => {
  it("resolves a route for known entity types", () => {
    const [g] = groupNotifications([item({ id: "a", createdAt: "x", targetType: "contact", targetId: "c1" })]);
    expect(notificationDeepLink(g)).toEqual({ route: "/contacts", entityType: "contact", entityId: "c1" });
  });

  it("returns null for an unroutable / missing target", () => {
    const [g] = groupNotifications([item({ id: "a", createdAt: "x", targetType: "payment", targetId: "p1" })]);
    expect(notificationDeepLink(g)).toBeNull();
    const [g2] = groupNotifications([item({ id: "b", createdAt: "x", targetType: null, targetId: null })]);
    expect(notificationDeepLink(g2)).toBeNull();
  });
});
