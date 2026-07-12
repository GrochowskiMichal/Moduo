import { describe, expect, it } from "vitest";

import { isModuoIdbName, moduoCacheKeysToClear } from "./advanced";

describe("moduoCacheKeysToClear — keys to clear (AC11)", () => {
  it("clears only moduo.* keys, never the auth session or other apps' keys", () => {
    const all = [
      "moduo.appearance",
      "moduo.appearance.sync",
      "moduo.focus",
      "moduo.calendar.sync",
      "sb-abcxyz-auth-token", // Supabase session — must survive
      "theme", // unrelated key
      "posthog_id",
    ];

    expect(moduoCacheKeysToClear(all).sort()).toEqual(
      ["moduo.appearance", "moduo.appearance.sync", "moduo.focus", "moduo.calendar.sync"].sort(),
    );
  });

  it("never returns the auth-session key (cloud data re-syncs; user stays signed in)", () => {
    const cleared = moduoCacheKeysToClear(["sb-ref-auth-token", "moduo.email.sync"]);
    expect(cleared).not.toContain("sb-ref-auth-token");
    expect(cleared).toContain("moduo.email.sync");
  });

  it("returns an empty list when nothing matches", () => {
    expect(moduoCacheKeysToClear(["sb-x-auth-token", "other"])).toEqual([]);
  });
});

describe("isModuoIdbName — notes IndexedDB scope (AC11)", () => {
  it("matches the notes-v2 meta/outbox DB and per-note doc DBs", () => {
    expect(isModuoIdbName("moduo-notes-v2")).toBe(true);
    expect(isModuoIdbName("moduo:notes-v2:doc:ws-1:note-42")).toBe(true);
  });

  it("rejects unrelated databases and empty names", () => {
    expect(isModuoIdbName("some-other-db")).toBe(false);
    expect(isModuoIdbName("keyval-store")).toBe(false);
    expect(isModuoIdbName(null)).toBe(false);
    expect(isModuoIdbName(undefined)).toBe(false);
    expect(isModuoIdbName("")).toBe(false);
  });
});
