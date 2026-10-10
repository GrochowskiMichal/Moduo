// Proves AC10 — notifications group by target then verb (digest-default, no
// per-event card), unread/read derive from the read mark, and the card renders a
// human sentence with a deep-link, never raw JSON.

import { describe, expect, it } from "@rstest/core";

import {
  activeNotifications,
  deriveNotificationFeeds,
  groupNotifications,
  type NotificationItem,
  notificationDeepLink,
  notificationDeepLinkNoun,
  notificationSubject,
  notificationSummary,
  partitionBySource,
  unnamedTaskTargets,
  unreadCount,
} from "./notifications";

function item(
  over: Partial<NotificationItem> & Pick<NotificationItem, "id" | "createdAt">,
): NotificationItem {
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
    dismissedAt: null,
    ...over,
  };
}

describe("groupNotifications", () => {
  it("collapses N rows on the same target+verb into one card with a count", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-06-26T10:00:00Z", payload: { excerpt: "first" } }),
      item({
        id: "b",
        createdAt: "2026-06-26T11:00:00Z",
        actorId: "u3",
        actorLabel: "Ola",
        payload: { excerpt: "second" },
      }),
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

// DF-21b — dismissed rows leave the active bell feed (+ badge) but persist for
// history; Undo (clearing dismissedAt) returns them in their prior read state.
describe("activeNotifications", () => {
  it("drops dismissed rows and keeps active ones", () => {
    const active = activeNotifications([
      item({ id: "a", createdAt: "x", dismissedAt: null }),
      item({ id: "b", createdAt: "x", dismissedAt: "2026-07-13T10:00:00Z" }),
      item({ id: "c", createdAt: "x", dismissedAt: null }),
    ]);
    expect(active.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("keeps a dismissed row's unread state intact for Undo (never counts it while dismissed)", () => {
    const rows = [
      item({ id: "a", createdAt: "x", readAt: null, dismissedAt: "2026-07-13T10:00:00Z" }), // unread + dismissed
      item({ id: "b", createdAt: "x", readAt: null, dismissedAt: null }),
    ];
    // While dismissed, the unread row is out of the active feed → not badged.
    expect(unreadCount(activeNotifications(rows))).toBe(1);
    // Undo restores dismissedAt=null → it re-enters active as unread again.
    const undone = rows.map((r) => (r.id === "a" ? { ...r, dismissedAt: null } : r));
    expect(unreadCount(activeNotifications(undone))).toBe(2);
  });
});

// DF-21c — the event feed (spine) and the legacy invite/membership feed
// (workspace) are split so invites surface in their own area (AC4).
describe("partitionBySource", () => {
  it("separates spine events from legacy workspace notifications", () => {
    const { spine, workspace } = partitionBySource([
      item({ id: "a", createdAt: "x", source: "spine" }),
      item({ id: "b", createdAt: "x", source: "workspace", op: "workspace.invite" }),
      item({ id: "c", createdAt: "x", source: "spine" }),
    ]);
    expect(spine.map((i) => i.id)).toEqual(["a", "c"]);
    expect(workspace.map((i) => i.id)).toEqual(["b"]);
  });

  it("returns empty buckets for an empty feed", () => {
    expect(partitionBySource([])).toEqual({ spine: [], workspace: [] });
  });
});

// DF-21c — the one place the bell's active / history / invitations / badge split
// is defined; proves AC2 (history keeps dismissed), AC3 (ws scope), AC4 (invites
// apart from the event feed), AC10 (mutes), AC11 (badge = unread events + invites).
describe("deriveNotificationFeeds", () => {
  const allOn = () => true;

  it("history KEEPS a dismissed row that active DROPS (AC2)", () => {
    const feeds = deriveNotificationFeeds(
      [
        item({
          id: "live",
          createdAt: "2026-07-13T10:00:00Z",
          workspaceId: "w1",
          dismissedAt: null,
        }),
        item({
          id: "gone",
          createdAt: "2026-07-13T09:00:00Z",
          workspaceId: "w1",
          dismissedAt: "2026-07-13T11:00:00Z",
        }),
      ],
      { workspaceId: "w1", isEnabled: allOn },
    );
    expect(feeds.active.map((i) => i.id)).toEqual(["live"]);
    expect(feeds.history.map((i) => i.id).sort()).toEqual(["gone", "live"]);
  });

  it("scopes events to the current workspace and splits out invitations (AC3, AC4)", () => {
    const feeds = deriveNotificationFeeds(
      [
        item({ id: "here", createdAt: "x", source: "spine", workspaceId: "w1" }),
        item({ id: "elsewhere", createdAt: "x", source: "spine", workspaceId: "w2" }),
        item({
          id: "invite",
          createdAt: "x",
          source: "workspace",
          workspaceId: "w2",
          op: "workspace.invite",
        }),
      ],
      { workspaceId: "w1", isEnabled: allOn },
    );
    expect(feeds.active.map((i) => i.id)).toEqual(["here"]);
    expect(feeds.history.map((i) => i.id)).toEqual(["here"]); // other-ws spine excluded
    // The invite is separate, never in the event feed/history, regardless of its workspace.
    expect(feeds.invitations.map((i) => i.id)).toEqual(["invite"]);
  });

  it("drops muted event types from active AND history (AC10)", () => {
    const isEnabled = (op: string) => op !== "tasks.assigned";
    const feeds = deriveNotificationFeeds(
      [
        item({ id: "keep", createdAt: "x", workspaceId: "w1", op: "comments.add" }),
        item({ id: "muted", createdAt: "x", workspaceId: "w1", op: "tasks.assigned" }),
      ],
      { workspaceId: "w1", isEnabled },
    );
    expect(feeds.active.map((i) => i.id)).toEqual(["keep"]);
    expect(feeds.history.map((i) => i.id)).toEqual(["keep"]);
  });

  it("badge counts unread events + unread invitations; excludes dismissed, muted, read (AC11)", () => {
    const feeds = deriveNotificationFeeds(
      [
        item({ id: "unread", createdAt: "x", workspaceId: "w1", readAt: null }),
        item({ id: "read", createdAt: "x", workspaceId: "w1", readAt: "2026-07-13T00:00:00Z" }),
        item({
          id: "dismissed",
          createdAt: "x",
          workspaceId: "w1",
          readAt: null,
          dismissedAt: "2026-07-13T00:00:00Z",
        }),
        // An unread invite DOES nudge the badge (designer call) — even cross-workspace.
        item({
          id: "invite",
          createdAt: "x",
          source: "workspace",
          workspaceId: "w2",
          readAt: null,
          op: "workspace.invite",
        }),
        item({
          id: "invite-read",
          createdAt: "x",
          source: "workspace",
          workspaceId: "w2",
          readAt: "x",
          op: "workspace.invite",
        }),
      ],
      { workspaceId: "w1", isEnabled: allOn },
    );
    expect(feeds.unreadCount).toBe(2); // "unread" event + "invite"
  });
});

describe("notificationSummary", () => {
  it("renders a human sentence, attributing the latest actor + others", () => {
    const groups = groupNotifications([
      item({
        id: "a",
        createdAt: "2026-06-26T10:00:00Z",
        actorId: "u2",
        actorLabel: "Mike",
        payload: { excerpt: "hi" },
      }),
      item({
        id: "b",
        createdAt: "2026-06-26T12:00:00Z",
        actorId: "u3",
        actorLabel: "Ola",
        payload: { excerpt: "yo" },
      }),
    ]);
    expect(notificationSummary(groups[0], "me")).toBe("Ola and 1 other commented: “yo”");
  });

  it("says You for the current user's own latest action", () => {
    const groups = groupNotifications([
      item({
        id: "a",
        createdAt: "2026-06-26T10:00:00Z",
        actorId: "me",
        op: "links.create",
        payload: { relation_kind: "follow-up" },
      }),
    ]);
    expect(notificationSummary(groups[0], "me")).toBe("You added a follow-up");
  });

  it("humanizes a legacy/unknown event type instead of showing it raw", () => {
    const groups = groupNotifications([
      item({
        id: "a",
        createdAt: "2026-06-26T10:00:00Z",
        op: "note_shared",
        actorLabel: "Mike",
        actorId: "u2",
      }),
    ]);
    expect(notificationSummary(groups[0], "me")).toBe("Mike note shared");
  });

  // DF-9: the two new quiet task notifications render a plain sentence, never the raw op.
  it("phrases an assigned-to-you notification with the assigner as actor", () => {
    const groups = groupNotifications([
      item({
        id: "a",
        createdAt: "2026-07-12T10:00:00Z",
        op: "tasks.assigned",
        actorId: "u2",
        actorLabel: "Mike",
      }),
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
    expect(notificationSummary(withBlocker, "me")).toBe(
      "You finished “Ship the API”, unblocking this",
    );

    const [noBlocker] = groupNotifications([
      item({
        id: "b",
        createdAt: "2026-07-12T10:00:00Z",
        op: "tasks.unblocked",
        actorId: "u2",
        actorLabel: "Ola",
      }),
    ]);
    expect(notificationSummary(noBlocker, "me")).toBe("Ola unblocked this");
  });

  // DF-21 AC7: every feed op maps to a quiet human sentence — never a raw op
  // token or JSON. Covers the full taxonomy the bell renders: @mention (comments),
  // assigned, unblocked, email snooze-due + follow-up-due (DF-21d card copy), and a
  // legacy invite/membership event.
  it("renders quiet copy for every type incl. comments and email-due, never a raw op", () => {
    const cases: Array<{
      op: string;
      actorId: string;
      payload?: Record<string, unknown>;
      expect: string;
    }> = [
      {
        op: "comments.add",
        actorId: "u2",
        payload: { excerpt: "looks good" },
        expect: "Mike commented: “looks good”",
      },
      { op: "comments.add", actorId: "u2", expect: "Mike left a comment" },
      { op: "tasks.assigned", actorId: "u2", expect: "Mike assigned this to you" },
      { op: "tasks.unblocked", actorId: "u2", expect: "Mike unblocked this" },
      {
        op: "email.snooze_due",
        actorId: "me",
        payload: { subject: "Invoice #42" },
        expect: "You have a snoozed email back: “Invoice #42”",
      },
      { op: "email.snooze_due", actorId: "me", expect: "You have a snoozed email back" },
      {
        op: "email.follow_up_due",
        actorId: "me",
        payload: { subject: "Re: proposal" },
        expect: "You have a follow-up due: “Re: proposal”",
      },
      { op: "email.follow_up_due", actorId: "me", expect: "You have a follow-up due" },
      { op: "workspace.invite", actorId: "u2", expect: "Mike invite" },
    ];
    for (const c of cases) {
      const [g] = groupNotifications([
        item({
          id: c.op + c.actorId,
          createdAt: "2026-07-14T10:00:00Z",
          op: c.op,
          actorId: c.actorId,
          actorLabel: "Mike",
          payload: c.payload ?? {},
        }),
      ]);
      const summary = notificationSummary(g, "me");
      expect(summary).toBe(c.expect);
      // Never leaks a raw op token (a dot- or snake-cased identifier).
      expect(summary).not.toContain(c.op);
    }
  });
});

describe("notificationDeepLink", () => {
  it("resolves a route for known entity types", () => {
    const [g] = groupNotifications([
      item({ id: "a", createdAt: "x", targetType: "contact", targetId: "c1" }),
    ]);
    expect(notificationDeepLink(g)).toEqual({
      route: "/contacts",
      entityType: "contact",
      entityId: "c1",
    });
  });

  it("returns null for an unroutable / missing target", () => {
    const [g] = groupNotifications([
      item({ id: "a", createdAt: "x", targetType: "payment", targetId: "p1" }),
    ]);
    expect(notificationDeepLink(g)).toBeNull();
    const [g2] = groupNotifications([
      item({ id: "b", createdAt: "x", targetType: null, targetId: null }),
    ]);
    expect(notificationDeepLink(g2)).toBeNull();
  });

  // DF-9: email snooze/follow-up notifications (entity_type='email_thread') must
  // deep-link the thread, not dead-end. entityType flows to the entity-open host,
  // which resolves email_thread → /email?thread=<id> (DF-2).
  it("routes an email_thread notification to /email so it deep-links the thread", () => {
    const [g] = groupNotifications([
      item({
        id: "a",
        createdAt: "x",
        op: "email.snooze_due",
        targetType: "email_thread",
        targetId: "th1",
      }),
    ]);
    expect(notificationDeepLink(g)).toEqual({
      route: "/email",
      entityType: "email_thread",
      entityId: "th1",
    });
  });
});

describe("notificationDeepLinkNoun", () => {
  it("rewrites the ugly email_thread type to a friendly noun, passing others through", () => {
    expect(notificationDeepLinkNoun("email_thread")).toBe("email");
    expect(notificationDeepLinkNoun("task")).toBe("task");
    expect(notificationDeepLinkNoun("contact")).toBe("contact");
  });
});

// TV-P0 (tasks-v3 AC1.7): a task's notice names the task.
describe("notifications name the task", () => {
  const one = (over: Partial<NotificationItem>) =>
    groupNotifications([item({ id: "a", createdAt: "2026-10-10T10:00:00Z", ...over })])[0];

  it("uses the title the event carried, in place of “this”", () => {
    const assigned = one({ op: "tasks.assigned", payload: { title: "Draft the brief" } });
    expect(notificationSummary(assigned, "me", notificationSubject(assigned))).toBe(
      "Mike assigned “Draft the brief” to you",
    );
    const done = one({ op: "tasks.completed", payload: { title: "Ship it" } });
    expect(notificationSummary(done, "me", notificationSubject(done))).toBe(
      "Mike completed “Ship it”",
    );
    const unblocked = one({
      op: "tasks.unblocked",
      payload: { title: "Launch", blocker_title: "Ship the API" },
    });
    expect(notificationSummary(unblocked, "me", notificationSubject(unblocked))).toBe(
      "Mike finished “Ship the API”, unblocking “Launch”",
    );
  });

  it("a comment's card takes a resolved name, kept apart from the excerpt", () => {
    const comment = one({ op: "comments.add", payload: { excerpt: "looks good" } });
    expect(notificationSubject(comment)).toBeNull();
    expect(unnamedTaskTargets([comment])).toEqual(["t1"]);
    const labels = new Map([["t1", "Q4 plan"]]);
    expect(notificationSummary(comment, "me", notificationSubject(comment, labels))).toBe(
      "Mike commented on “Q4 plan”: “looks good”",
    );
    const bare = one({ op: "comments.add" });
    expect(notificationSummary(bare, "me", notificationSubject(bare, labels))).toBe(
      "Mike left a comment on “Q4 plan”",
    );
  });

  it("never rewrites a “this” inside the user's own words", () => {
    const comment = one({ op: "comments.add", payload: { excerpt: "is this done?" } });
    expect(notificationSummary(comment, "me", "Q4 plan")).toBe(
      "Mike commented on “Q4 plan”: “is this done?”",
    );
    const unblocked = one({
      op: "tasks.unblocked",
      payload: { title: "Launch", blocker_title: "Fix this bug" },
    });
    expect(notificationSummary(unblocked, "me", notificationSubject(unblocked))).toBe(
      "Mike finished “Fix this bug”, unblocking “Launch”",
    );
  });

  it("names only tasks, and says “this” when the name isn't known", () => {
    const note = one({ op: "comments.add", targetType: "note", payload: { title: "Hidden" } });
    expect(notificationSubject(note, new Map([["t1", "x"]]))).toBeNull();
    expect(unnamedTaskTargets([note])).toEqual([]);
    const unknown = one({ op: "tasks.assigned" });
    expect(notificationSummary(unknown, "me", notificationSubject(unknown))).toBe(
      "Mike assigned this to you",
    );
  });
});
