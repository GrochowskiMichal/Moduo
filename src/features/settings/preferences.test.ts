import { beforeEach, describe, expect, it } from "@rstest/core";

import {
  applyMotion,
  consumeLandingRedirect,
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_PREFERENCES,
  isNotificationEnabled,
  mergeFoldsForward,
  mergeOnboardingForward,
  notificationTypeForOp,
  readLastRoute,
  resetLandingRedirectForTest,
  resolveLandingRoute,
  sanitizePreferences,
  writeLastRoute,
} from "../../lib/preferences";

beforeEach(() => {
  localStorage.clear();
  resetLandingRedirectForTest();
  document.documentElement.removeAttribute("data-motion");
});

describe("DEFAULT_PREFERENCES", () => {
  it("defaults to Home landing, reopen-last-workspace on, sound on, system motion, mutes on + overdue opt-in off, confirm-quit off", () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      landingView: "home",
      reopenLastWorkspace: true,
      soundEnabled: true,
      chatSound: false,
      motion: "system",
      notifications: {
        mention: true,
        assigned: true,
        comments: true,
        completed: true,
        dueFollowUp: true,
        waiting: true,
        teams: true,
        agents: true,
        overdueTasks: false,
        storage: true,
        bookings: true,
        chatDirect: true,
        chatMentions: true,
        chatAnnouncements: true,
        chatEvery: true,
      },
      confirmBeforeQuit: false,
      keepInMenuBar: true,
      tasksSidebar: { hidden: [], pinned: {} },
      tasksInbox: { snoozed: {} },
      tasksOnboarding: {
        role: null,
        roleAt: null,
        welcomeSeenAt: null,
        seeded: {},
        viewsSeeded: {},
      },
      tasksFolds: {},
      notesExperience: "classic",
    });
  });
});

describe("sanitizePreferences", () => {
  it("returns defaults for non-objects", () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid fields and falls back on invalid ones", () => {
    expect(
      sanitizePreferences({
        landingView: "calendar",
        reopenLastWorkspace: false,
        soundEnabled: false,
        motion: "reduced",
        notifications: { mention: false, assigned: true, dueFollowUp: false, unblocked: true },
        confirmBeforeQuit: true,
      }),
    ).toEqual({
      landingView: "calendar",
      reopenLastWorkspace: false,
      soundEnabled: false,
      chatSound: false,
      motion: "reduced",
      // overdueTasks absent from input → coerced to its opt-in default (off);
      // completed (added in TV-D1), storage (AT-1) and comments (TV-D12) absent →
      // on, like every other mute; the old `unblocked` becomes `waiting`.
      notifications: {
        mention: false,
        assigned: true,
        comments: true,
        completed: true,
        dueFollowUp: false,
        waiting: true,
        teams: true,
        agents: true,
        overdueTasks: false,
        storage: true,
        bookings: true,
        chatDirect: true,
        chatMentions: true,
        chatAnnouncements: true,
        chatEvery: true,
      },
      confirmBeforeQuit: true,
      keepInMenuBar: true,
      tasksSidebar: { hidden: [], pinned: {} },
      tasksInbox: { snoozed: {} },
      tasksOnboarding: {
        role: null,
        roleAt: null,
        welcomeSeenAt: null,
        seeded: {},
        viewsSeeded: {},
      },
      tasksFolds: {},
      // Absent → classic (the New Notes switch is off by default, NR-2).
      notesExperience: "classic",
    });
  });

  it("rejects out-of-set enum values and wrong types", () => {
    const out = sanitizePreferences({
      landingView: "mindmap", // not a landable option
      reopenLastWorkspace: "yes", // not a boolean
      soundEnabled: 1, // not a boolean
      motion: "spinny", // not a motion pref
    });
    expect(out).toEqual(DEFAULT_PREFERENCES);
  });

  it("defaults notifications all-on when the object is absent", () => {
    expect(sanitizePreferences({ landingView: "tasks" }).notifications).toEqual(
      DEFAULT_NOTIFICATION_PREFS,
    );
  });

  it("coerces notifications per-key: missing/non-boolean → per-key default (mutes on, overdue off), valid kept", () => {
    expect(
      sanitizePreferences({
        notifications: { mention: false, assigned: "nope", unblocked: false },
      }).notifications,
    ).toEqual({
      mention: false,
      assigned: true,
      comments: true,
      completed: true,
      dueFollowUp: true,
      // A saved `unblocked: false` (before TV-D12) carries over to `waiting`.
      waiting: false,
      teams: true,
      agents: true,
      overdueTasks: false,
      storage: true,
      bookings: true,
      chatDirect: true,
      chatMentions: true,
      chatAnnouncements: true,
      chatEvery: true,
    });
    expect(
      sanitizePreferences({ notifications: { unblocked: false, waiting: true } }).notifications
        .waiting,
    ).toBe(true);
  });

  it("defaults keepInMenuBar on and coerces to boolean (TV-D12)", () => {
    expect(sanitizePreferences({}).keepInMenuBar).toBe(true);
    expect(sanitizePreferences({ keepInMenuBar: false }).keepInMenuBar).toBe(false);
    expect(sanitizePreferences({ keepInMenuBar: "no" }).keepInMenuBar).toBe(true);
  });

  it("keeps the Tasks sidebar's hidden rows and pins, dropping bad entries (TV-U6)", () => {
    expect(
      sanitizePreferences({
        tasksSidebar: {
          hidden: ["focus", "all", "focus", "inbox", 3],
          pinned: { ws1: ["p1", "p2", "p1", "", 7], ws2: "nope", ws3: [] },
        },
      }).tasksSidebar,
    ).toEqual({ hidden: ["focus", "all"], pinned: { ws1: ["p1", "p2"] } });
    expect(sanitizePreferences({ tasksSidebar: "nope" }).tasksSidebar).toEqual({
      hidden: [],
      pinned: {},
    });
  });

  it("keeps snoozed Inbox tasks, dropping bad entries (TV-U15)", () => {
    expect(
      sanitizePreferences({
        tasksInbox: {
          snoozed: {
            ws1: {
              t1: { until: "2026-10-20", stamp: "s#1" },
              t2: { until: "next week" },
              t3: { until: "2026-10-21" },
              t4: null,
            },
            ws2: "nope",
          },
        },
      }).tasksInbox,
    ).toEqual({
      snoozed: {
        ws1: {
          t1: { until: "2026-10-20", stamp: "s#1" },
          t3: { until: "2026-10-21", stamp: null },
        },
      },
    });
    expect(sanitizePreferences({ tasksInbox: "nope" }).tasksInbox).toEqual({ snoozed: {} });
  });

  it("keeps the role and the welcome's stamps, dropping bad ones (TV-U17)", () => {
    expect(
      sanitizePreferences({
        tasksOnboarding: {
          role: "developer",
          roleAt: "2026-10-13T09:00:00.000Z",
          welcomeSeenAt: "2026-10-13T09:00:01.000Z",
          seeded: { ws1: "2026-10-13T09:00:02.000Z", ws2: "soon", ws3: 4 },
          viewsSeeded: { ws1: "2026-10-13T09:00:03.000Z", ws2: false },
        },
      }).tasksOnboarding,
    ).toEqual({
      role: "developer",
      roleAt: "2026-10-13T09:00:00.000Z",
      welcomeSeenAt: "2026-10-13T09:00:01.000Z",
      seeded: { ws1: "2026-10-13T09:00:02.000Z" },
      viewsSeeded: { ws1: "2026-10-13T09:00:03.000Z" },
    });
    expect(
      sanitizePreferences({
        tasksOnboarding: { role: "astronaut", roleAt: "yesterday", welcomeSeenAt: 1 },
      }).tasksOnboarding,
    ).toEqual({ role: null, roleAt: null, welcomeSeenAt: null, seeded: {}, viewsSeeded: {} });
    expect(sanitizePreferences({ tasksOnboarding: "nope" }).tasksOnboarding).toEqual(
      DEFAULT_PREFERENCES.tasksOnboarding,
    );
  });

  it("keeps each List's and Board's folds, newest first, dropping bad ones (TV-U8)", () => {
    const folds = sanitizePreferences({
      tasksFolds: {
        "ws1:all:bucket": { at: "2026-10-13T09:00:00.000Z", folds: { p1: true, p2: "yes" } },
        "ws1:mine:status": { at: "not a time", folds: { todo: true } },
        "ws1:view:abc:board:status": { at: "2026-10-13T10:00:00.000Z", folds: { "col:x": false } },
        "": { at: "2026-10-13T10:00:00.000Z", folds: {} },
      },
    }).tasksFolds;
    expect(folds).toEqual({
      "ws1:view:abc:board:status": { at: "2026-10-13T10:00:00.000Z", folds: { "col:x": false } },
      "ws1:all:bucket": { at: "2026-10-13T09:00:00.000Z", folds: { p1: true } },
    });
    expect(Object.keys(folds)[0]).toBe("ws1:view:abc:board:status");
    expect(sanitizePreferences({ tasksFolds: "nope" }).tasksFolds).toEqual({});
  });

  it("defaults confirmBeforeQuit false and coerces to boolean", () => {
    expect(sanitizePreferences({}).confirmBeforeQuit).toBe(false);
    expect(sanitizePreferences({ confirmBeforeQuit: true }).confirmBeforeQuit).toBe(true);
    expect(sanitizePreferences({ confirmBeforeQuit: "yes" }).confirmBeforeQuit).toBe(false);
  });
});

describe("mergeFoldsForward (TV-U8: each List's newest folds win)", () => {
  it("keeps this device's newer folds and the cloud's newer ones", () => {
    const local = {
      "w:all:bucket": { at: "2026-10-13T10:00:00.000Z", folds: { p1: true } },
      "w:mine:status": { at: "2026-10-13T08:00:00.000Z", folds: { todo: true } },
    };
    const cloud = {
      "w:all:bucket": { at: "2026-10-13T09:00:00.000Z", folds: { p1: false } },
      "w:mine:status": { at: "2026-10-13T09:00:00.000Z", folds: { todo: false } },
      "w:p9:section": { at: "2026-10-13T07:00:00.000Z", folds: { s1: true } },
    };
    expect(mergeFoldsForward(local, cloud)).toEqual({
      "w:all:bucket": { at: "2026-10-13T10:00:00.000Z", folds: { p1: true } },
      "w:mine:status": { at: "2026-10-13T09:00:00.000Z", folds: { todo: false } },
      "w:p9:section": { at: "2026-10-13T07:00:00.000Z", folds: { s1: true } },
    });
  });

  it("keeps a List's newest 200 folds", () => {
    const folds = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`g${i}`, true]));
    const merged = mergeFoldsForward(
      { "w:all:bucket": { at: "2026-10-13T10:00:00.000Z", folds } },
      {},
    );
    const kept = Object.keys(merged["w:all:bucket"]?.folds ?? {});
    expect(kept).toHaveLength(200);
    expect(kept[0]).toBe("g5");
    expect(kept.at(-1)).toBe("g204");
  });
});

describe("mergeOnboardingForward (TV-U17: onboarding only moves forward)", () => {
  const none = { role: null, roleAt: null, welcomeSeenAt: null, seeded: {}, viewsSeeded: {} };
  const seenHere = {
    role: "pm" as const,
    roleAt: "2026-10-13T09:00:00.000Z",
    welcomeSeenAt: "2026-10-13T09:00:00.000Z",
    seeded: { ws1: "2026-10-13T09:00:00.000Z" },
    viewsSeeded: { ws1: "2026-10-13T09:01:00.000Z" },
  };

  it("keeps what this device already knows when a stale copy comes back", () => {
    expect(mergeOnboardingForward(seenHere, none)).toEqual(seenHere);
  });

  it("takes the cloud's answer and seen stamp when it has them, adding up seeded workspaces", () => {
    const cloud = {
      role: "creator" as const,
      roleAt: "2026-10-14T09:00:00.000Z",
      welcomeSeenAt: "2026-10-14T09:00:00.000Z",
      seeded: { ws2: "2026-10-14T09:00:00.000Z" },
      viewsSeeded: { ws2: "2026-10-14T09:01:00.000Z" },
    };
    expect(mergeOnboardingForward(seenHere, cloud)).toEqual({
      role: "creator",
      roleAt: "2026-10-14T09:00:00.000Z",
      welcomeSeenAt: "2026-10-14T09:00:00.000Z",
      seeded: { ws1: "2026-10-13T09:00:00.000Z", ws2: "2026-10-14T09:00:00.000Z" },
      // Saved views seeded on either device stay seeded (TV-U8).
      viewsSeeded: { ws1: "2026-10-13T09:01:00.000Z", ws2: "2026-10-14T09:01:00.000Z" },
    });
  });

  it("a skipped role (answered, no role) stays skipped", () => {
    const skipped = { ...none, roleAt: "2026-10-13T09:00:00.000Z" };
    expect(mergeOnboardingForward(skipped, none)).toEqual(skipped);
  });
});

describe("notificationTypeForOp", () => {
  it("maps each quiet-set op to its governing toggle", () => {
    expect(notificationTypeForOp("comments.add")).toBe("comments");
    expect(notificationTypeForOp("comments.edit")).toBe("mention");
    expect(notificationTypeForOp("tasks.mentioned")).toBe("mention");
    expect(notificationTypeForOp("notes.mention")).toBe("mention");
    expect(notificationTypeForOp("tasks.assigned")).toBe("assigned");
    expect(notificationTypeForOp("tasks.project_deleted")).toBe("assigned");
    expect(notificationTypeForOp("tasks.waiting_resolved")).toBe("waiting");
    expect(notificationTypeForOp("tasks.completed")).toBe("completed");
    expect(notificationTypeForOp("email.snooze_due")).toBe("dueFollowUp");
    expect(notificationTypeForOp("email.follow_up_due")).toBe("dueFollowUp");
    expect(notificationTypeForOp("tasks.unblocked")).toBe("waiting");
    // A reminder has no switch: the reminder itself turns it off (spec §13).
    expect(notificationTypeForOp("tasks.reminder")).toBeNull();
    expect(notificationTypeForOp("attachments.storage_80")).toBe("storage");
    expect(notificationTypeForOp("attachments.storage_95")).toBe("storage");
    expect(notificationTypeForOp("calendar.booking_create")).toBe("bookings");
    expect(notificationTypeForOp("calendar.booking_cancel")).toBe("bookings");
    // TV-D13: your team's mute; tasks back from someone who left are yours.
    expect(notificationTypeForOp("tasks.routed")).toBe("teams");
    expect(notificationTypeForOp("tasks.team_check_back")).toBe("teams");
    expect(notificationTypeForOp("comments.team_mention")).toBe("teams");
    expect(notificationTypeForOp("tasks.handed_back")).toBe("assigned");
  });

  it("sends a chat row that reached you through a team to the teams switch (CV-5)", () => {
    expect(notificationTypeForOp("chat.mention", { reason: "team" })).toBe("teams");
    // CV-6b: everything else of chat.mention follows "Mentions and replies".
    expect(notificationTypeForOp("chat.mention", { reason: "person" })).toBe("chatMentions");
    expect(notificationTypeForOp("chat.mention")).toBe("chatMentions");
    expect(
      isNotificationEnabled(
        "chat.mention",
        { ...DEFAULT_PREFERENCES.notifications, teams: false },
        { reason: "team" },
      ),
    ).toBe(false);
  });

  it("returns null for ops outside the quiet set (legacy / future)", () => {
    expect(notificationTypeForOp("workspace.invite_accepted")).toBeNull();
    expect(notificationTypeForOp("note_shared")).toBeNull();
    expect(notificationTypeForOp("email.follow_up")).toBeNull(); // the SET op, not the DUE notification
  });
});

describe("isNotificationEnabled", () => {
  it("honours the toggle for a known op", () => {
    const prefs = {
      mention: true,
      assigned: false,
      comments: true,
      completed: false,
      dueFollowUp: true,
      waiting: false,
      teams: false,
      agents: false,
      overdueTasks: false,
      storage: false,
      bookings: false,
      chatDirect: false,
      chatMentions: false,
      chatAnnouncements: false,
      chatEvery: false,
    };
    expect(isNotificationEnabled("comments.add", prefs)).toBe(true);
    expect(isNotificationEnabled("attachments.storage_95", prefs)).toBe(false);
    expect(isNotificationEnabled("calendar.booking_create", prefs)).toBe(false);
    expect(isNotificationEnabled("tasks.assigned", prefs)).toBe(false);
    expect(isNotificationEnabled("tasks.completed", prefs)).toBe(false);
    expect(isNotificationEnabled("email.follow_up_due", prefs)).toBe(true);
    expect(isNotificationEnabled("tasks.unblocked", prefs)).toBe(false);
    // TV-D16: "Your agents" mutes an agent's needs you · ready · failed.
    expect(isNotificationEnabled("tasks.agent_status", prefs)).toBe(false);
    expect(isNotificationEnabled("tasks.agent_status", DEFAULT_NOTIFICATION_PREFS)).toBe(true);
  });

  it("splits a comment notice: naming you is a mention, anything else is comments (TV-D12)", () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, mention: true, comments: false };
    const named = { mentioned_user_ids: ["me"], notify_user_ids: [] };
    const participant = { mentioned_user_ids: [], notify_user_ids: ["me"] };
    expect(isNotificationEnabled("comments.add", prefs, named, "me")).toBe(true);
    expect(isNotificationEnabled("comments.add", prefs, participant, "me")).toBe(false);
    const quiet = { ...prefs, mention: false, comments: true };
    expect(isNotificationEnabled("comments.add", quiet, named, "me")).toBe(false);
    expect(isNotificationEnabled("comments.add", quiet, participant, "me")).toBe(true);
  });

  // CV-6b: chat's bell rows follow the Chat switches; @Team follows "Your teams".
  it("maps chat's bell rows to the Chat switches", () => {
    const off = { ...DEFAULT_NOTIFICATION_PREFS, chatMentions: false, chatAnnouncements: false };
    expect(isNotificationEnabled("chat.mention", off, { reason: "person" })).toBe(false);
    expect(isNotificationEnabled("chat.mention", off, { reason: "everyone" })).toBe(false);
    expect(isNotificationEnabled("chat.reply", off)).toBe(false);
    expect(isNotificationEnabled("chat.announcement", off)).toBe(false);
    expect(isNotificationEnabled("chat.mention", off, { reason: "team" })).toBe(true);
    expect(isNotificationEnabled("chat.mention", DEFAULT_NOTIFICATION_PREFS)).toBe(true);
  });

  it("fails open for an unmapped op regardless of prefs", () => {
    const allOff = {
      mention: false,
      assigned: false,
      comments: false,
      completed: false,
      dueFollowUp: false,
      waiting: false,
      teams: false,
      agents: false,
      overdueTasks: false,
      storage: false,
      bookings: false,
      chatDirect: false,
      chatMentions: false,
      chatAnnouncements: false,
      chatEvery: false,
    };
    expect(isNotificationEnabled("tasks.reminder", allOff)).toBe(true);
    expect(isNotificationEnabled("workspace.invite_accepted", allOff)).toBe(true);
    expect(isNotificationEnabled("note_shared", allOff)).toBe(true);
  });
});

describe("resolveLandingRoute", () => {
  it("stays on Home (null) for the home view", () => {
    expect(resolveLandingRoute("home", null)).toBeNull();
  });

  it("maps each module view to its route", () => {
    expect(resolveLandingRoute("tasks", null)).toBe("/tasks");
    expect(resolveLandingRoute("calendar", null)).toBe("/calendar");
    expect(resolveLandingRoute("notes", null)).toBe("/notes");
    expect(resolveLandingRoute("contacts", null)).toBe("/contacts");
    expect(resolveLandingRoute("email", null)).toBe("/email");
  });

  it("resolves 'last' to a valid remembered module route", () => {
    expect(resolveLandingRoute("last", "/notes")).toBe("/notes");
    expect(resolveLandingRoute("last", "/email")).toBe("/email");
  });

  it("'last' stays on Home when the remembered route is Home, unknown, or missing", () => {
    expect(resolveLandingRoute("last", "/")).toBeNull();
    expect(resolveLandingRoute("last", "/settings")).toBeNull();
    expect(resolveLandingRoute("last", "/bogus")).toBeNull();
    expect(resolveLandingRoute("last", null)).toBeNull();
  });
});

describe("writeLastRoute / readLastRoute", () => {
  it("persists only landable module routes", () => {
    writeLastRoute("/tasks");
    expect(readLastRoute()).toBe("/tasks");
    writeLastRoute("/settings"); // ignored — not landable
    expect(readLastRoute()).toBe("/tasks");
    writeLastRoute("/"); // Home is landable
    expect(readLastRoute()).toBe("/");
  });

  it("reads null when nothing valid is stored", () => {
    expect(readLastRoute()).toBeNull();
    localStorage.setItem("moduo.lastRoute", "/mindmap"); // not in the landable set
    expect(readLastRoute()).toBeNull();
  });
});

describe("applyMotion", () => {
  it("writes the motion value to <html data-motion>", () => {
    applyMotion("reduced");
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduced");
    applyMotion("full");
    expect(document.documentElement.getAttribute("data-motion")).toBe("full");
    applyMotion("system");
    expect(document.documentElement.getAttribute("data-motion")).toBe("system");
  });
});

describe("consumeLandingRedirect", () => {
  const signIn = () =>
    localStorage.setItem("sb-abcdef-auth-token", JSON.stringify({ access_token: "x" }));

  it("returns null when there is no persisted auth session (pre-login)", () => {
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "tasks" }));
    expect(consumeLandingRedirect("/", "")).toBeNull();
  });

  it("redirects to the landing route on the first authed launch at '/'", () => {
    signIn();
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "tasks" }));
    expect(consumeLandingRedirect("/", "")).toBe("/tasks");
  });

  it("is one-shot — a second call in the same load never redirects", () => {
    signIn();
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "tasks" }));
    expect(consumeLandingRedirect("/", "")).toBe("/tasks");
    expect(consumeLandingRedirect("/", "")).toBeNull();
  });

  it("does not consume the one-shot while signed out, so it still fires after login", () => {
    // Signed-out visit to "/" — must NOT burn the shot.
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "calendar" }));
    expect(consumeLandingRedirect("/", "")).toBeNull();
    // Now the session lands (post-login) and the app returns to "/".
    signIn();
    expect(consumeLandingRedirect("/", "")).toBe("/calendar");
  });

  it("lets explicit deep-links win — any query string at '/' skips the redirect", () => {
    signIn();
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "tasks" }));
    expect(consumeLandingRedirect("/", "?section=billing")).toBeNull();
  });

  it("only acts on '/' — a non-home path is never touched", () => {
    signIn();
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "tasks" }));
    expect(consumeLandingRedirect("/notes", "")).toBeNull();
  });

  it("stays on Home when the landing view is Home", () => {
    signIn();
    localStorage.setItem("moduo.preferences", JSON.stringify({ landingView: "home" }));
    expect(consumeLandingRedirect("/", "")).toBeNull();
  });
});
