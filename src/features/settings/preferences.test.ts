import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  applyMotion,
  consumeLandingRedirect,
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
  it("defaults to Home landing, reopen-last-workspace on, sound on, system motion", () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      landingView: "home",
      reopenLastWorkspace: true,
      soundEnabled: true,
      motion: "system",
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
      }),
    ).toEqual({
      landingView: "calendar",
      reopenLastWorkspace: false,
      soundEnabled: false,
      motion: "reduced",
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
