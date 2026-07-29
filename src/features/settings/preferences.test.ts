import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_PREFERENCES,
  applyMotion,
  consumeLandingRedirect,
  isNotificationEnabled,
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
      motion: "system",
      notifications: { mention: true, assigned: true, dueFollowUp: true, unblocked: true, overdueTasks: false },
      confirmBeforeQuit: false,
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
      motion: "reduced",
      // overdueTasks absent from input → coerced to its opt-in default (off).
      notifications: { mention: false, assigned: true, dueFollowUp: false, unblocked: true, overdueTasks: false },
      confirmBeforeQuit: true,
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
    ).toEqual({ mention: false, assigned: true, dueFollowUp: true, unblocked: false, overdueTasks: false });
  });

  it("defaults confirmBeforeQuit false and coerces to boolean", () => {
    expect(sanitizePreferences({}).confirmBeforeQuit).toBe(false);
    expect(sanitizePreferences({ confirmBeforeQuit: true }).confirmBeforeQuit).toBe(true);
    expect(sanitizePreferences({ confirmBeforeQuit: "yes" }).confirmBeforeQuit).toBe(false);
  });
});

describe("notificationTypeForOp", () => {
  it("maps each quiet-set op to its governing toggle", () => {
    expect(notificationTypeForOp("comments.add")).toBe("mention");
    expect(notificationTypeForOp("tasks.assigned")).toBe("assigned");
    expect(notificationTypeForOp("email.snooze_due")).toBe("dueFollowUp");
    expect(notificationTypeForOp("email.follow_up_due")).toBe("dueFollowUp");
    expect(notificationTypeForOp("tasks.unblocked")).toBe("unblocked");
  });

  it("returns null for ops outside the quiet set (legacy / future)", () => {
    expect(notificationTypeForOp("workspace.invite_accepted")).toBeNull();
    expect(notificationTypeForOp("note_shared")).toBeNull();
    expect(notificationTypeForOp("email.follow_up")).toBeNull(); // the SET op, not the DUE notification
  });
});

describe("isNotificationEnabled", () => {
  it("honours the toggle for a known op", () => {
    const prefs = { mention: true, assigned: false, dueFollowUp: true, unblocked: false, overdueTasks: false };
    expect(isNotificationEnabled("comments.add", prefs)).toBe(true);
    expect(isNotificationEnabled("tasks.assigned", prefs)).toBe(false);
    expect(isNotificationEnabled("email.follow_up_due", prefs)).toBe(true);
    expect(isNotificationEnabled("tasks.unblocked", prefs)).toBe(false);
  });

  it("fails open for an unmapped op regardless of prefs", () => {
    const allOff = { mention: false, assigned: false, dueFollowUp: false, unblocked: false, overdueTasks: false };
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
