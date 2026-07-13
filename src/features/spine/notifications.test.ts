// Proves AC10 — notifications group by target then verb (digest-default, no
// per-event card), unread/read derive from the read mark, and the card renders a
// human sentence with a deep-link, never raw JSON.

import { describe, expect, it } from "vitest";

import {
  filterNotificationsByPrefs,
  groupNotifications,
  notificationBadgeCount,
  notificationDeepLink,
  notificationDeepLinkNoun,
  notificationPrefKey,
  notificationSummary,
  notificationsForWorkspace,
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

  // DF-9: the two new quiet task notifications render a plain sentence, never the raw op.
  it("phrases an assigned-to-you notification with the assigner as actor", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-07-12T10:00:00Z", op: "tasks.assigned", actorId: "u2", actorLabel: "Mike" }),
    ]);
    expect(notificationSummary(groups[0], "me")).toBe("Mike assigned this to you");
  });

  it("phrases a blocked-task-unblocked notification, naming the finished blocker when present", () => {
    const [withBlocker] = groupNotifications([
      item({
        id: "a",
        createdAt: "2026-07-12T10:00:00Z",
        op: "tasks.unblocked",
        actorId: "me",
        payload: { blocker_title: "Ship the API" },
      }),
    ]);
    expect(notificationSummary(withBlocker, "me")).toBe("You finished “Ship the API”, unblocking this");

    const [noBlocker] = groupNotifications([
      item({ id: "b", createdAt: "2026-07-12T10:00:00Z", op: "tasks.unblocked", actorId: "u2", actorLabel: "Ola" }),
    ]);
    expect(notificationSummary(noBlocker, "me")).toBe("Ola unblocked this");
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

  // DF-9: email snooze/follow-up notifications (entity_type='email_thread') must
  // deep-link the thread, not dead-end. entityType flows to the entity-open host,
  // which resolves email_thread → /email?thread=<id> (DF-2).
  it("routes an email_thread notification to /email so it deep-links the thread", () => {
    const [g] = groupNotifications([
      item({ id: "a", createdAt: "x", op: "email.snooze_due", targetType: "email_thread", targetId: "th1" }),
    ]);
    expect(notificationDeepLink(g)).toEqual({ route: "/email", entityType: "email_thread", entityId: "th1" });
  });
});

describe("notificationDeepLinkNoun", () => {
  it("rewrites the ugly email_thread type to a friendly noun, passing others through", () => {
    expect(notificationDeepLinkNoun("email_thread")).toBe("email");
    expect(notificationDeepLinkNoun("task")).toBe("task");
    expect(notificationDeepLinkNoun("contact")).toBe("contact");
  });
});

// DF-21a: the shared pref taxonomy — the bell hides a muted category, but never
// swallows a row it can't classify (graceful degrade with DF-19f's toggles).
describe("notificationPrefKey", () => {
  it("classifies each notification into its preference category", () => {
    const me = "me";
    expect(notificationPrefKey(item({ id: "a", createdAt: "x", source: "workspace", op: "workspace.invite" }), me)).toBe(
      "invites",
    );
    expect(notificationPrefKey(item({ id: "b", createdAt: "x", op: "tasks.assigned" }), me)).toBe("assigned");
    expect(notificationPrefKey(item({ id: "c", createdAt: "x", op: "tasks.unblocked" }), me)).toBe("unblocked");
    expect(
      notificationPrefKey(item({ id: "d", createdAt: "x", op: "email.snooze_due", targetType: "email_thread" }), me),
    ).toBe("emailDue");
    expect(
      notificationPrefKey(item({ id: "e", createdAt: "x", op: "email.follow_up_due", targetType: "email_thread" }), me),
    ).toBe("emailDue");
    // comments.add is a MENTION when I'm mentioned, else a comment-on-my-entity.
    expect(
      notificationPrefKey(item({ id: "f", createdAt: "x", op: "comments.add", payload: { mentioned_user_ids: ["me"] } }), me),
    ).toBe("mentions");
    expect(
      notificationPrefKey(item({ id: "g", createdAt: "x", op: "comments.add", payload: { notify_user_ids: ["me"] } }), me),
    ).toBe("comments");
  });

  it("returns null for an unclassified row (always shown)", () => {
    expect(notificationPrefKey(item({ id: "a", createdAt: "x", op: "links.create", payload: {} }), "me")).toBeNull();
    // no current user → can't resolve mention/comment → unclassified.
    expect(notificationPrefKey(item({ id: "b", createdAt: "x", op: "comments.add", payload: { mentioned_user_ids: ["me"] } }), null)).toBeNull();
  });
});

describe("filterNotificationsByPrefs", () => {
  it("drops a muted category and keeps the rest", () => {
    const items = [
      item({ id: "a", createdAt: "x", op: "comments.add", payload: { mentioned_user_ids: ["me"] } }), // mentions
      item({ id: "b", createdAt: "x", op: "tasks.assigned" }), // assigned
      item({ id: "c", createdAt: "x", op: "email.snooze_due", targetType: "email_thread" }), // emailDue
    ];
    const kept = filterNotificationsByPrefs(items, { mentions: false }, "me");
    expect(kept.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("shows everything when a category's pref is absent (graceful degrade)", () => {
    const items = [
      item({ id: "a", createdAt: "x", op: "comments.add", payload: { mentioned_user_ids: ["me"] } }),
      item({ id: "b", createdAt: "x", op: "tasks.assigned" }),
    ];
    expect(filterNotificationsByPrefs(items, {}, "me")).toHaveLength(2);
    // an explicit true is also "shown".
    expect(filterNotificationsByPrefs(items, { mentions: true, assigned: true }, "me")).toHaveLength(2);
  });
});

// AC3 — the event feed is scoped to the current workspace (no unrelated-ws noise).
describe("notificationsForWorkspace", () => {
  it("keeps only the current workspace's rows", () => {
    const items = [
      item({ id: "a", createdAt: "x", workspaceId: "w1" }),
      item({ id: "b", createdAt: "x", workspaceId: "w2" }),
      item({ id: "c", createdAt: "x", workspaceId: "w1" }),
    ];
    expect(notificationsForWorkspace(items, "w1").map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("returns the input untouched before a workspace resolves (null)", () => {
    const items = [item({ id: "a", createdAt: "x", workspaceId: "w1" })];
    expect(notificationsForWorkspace(items, null)).toHaveLength(1);
  });
});

// AC11 — the badge counts unread events only and caps at 99.
describe("notificationBadgeCount", () => {
  it("caps a busy feed at 99", () => {
    const many = Array.from({ length: 120 }, (_, n) =>
      item({ id: String(n), createdAt: "x", targetId: String(n), readAt: null }),
    );
    expect(notificationBadgeCount(many)).toBe(99);
  });

  it("counts only unread rows", () => {
    expect(
      notificationBadgeCount([
        item({ id: "a", createdAt: "x", readAt: null }),
        item({ id: "b", createdAt: "x", readAt: "2026-01-01T00:00:00Z" }),
        item({ id: "c", createdAt: "x", readAt: null }),
      ]),
    ).toBe(2);
  });
});
