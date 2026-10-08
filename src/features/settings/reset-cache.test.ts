import { describe, expect, it } from "@rstest/core";

import { isModuoIdbName, moduoCacheKeysToClear, resetBlockedMessage } from "./advanced";

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

  it("matches the upload queue's DB (AT-2)", () => {
    expect(isModuoIdbName("moduo-uploads")).toBe(true);
  });

  it("rejects unrelated databases and empty names", () => {
    expect(isModuoIdbName("some-other-db")).toBe(false);
    expect(isModuoIdbName("keyval-store")).toBe(false);
    expect(isModuoIdbName(null)).toBe(false);
    expect(isModuoIdbName(undefined)).toBe(false);
    expect(isModuoIdbName("")).toBe(false);
  });
});

describe("resetBlockedMessage — pending uploads block the reset too (AT2-6)", () => {
  it("counts files still uploading", () => {
    expect(resetBlockedMessage({ pendingNotes: 0, pendingUploads: 2, online: true })).toBe(
      "2 files haven't finished uploading. Resetting now would lose them. Wait for them to finish (notes sync in Notes; files upload on their task), then re-check.",
    );
  });

  it("names notes and files together, offline", () => {
    expect(resetBlockedMessage({ pendingNotes: 1, pendingUploads: 1, online: false })).toBe(
      "1 note change hasn't synced to the cloud yet, and 1 file hasn't finished uploading. Resetting now would lose them. Reconnect to the internet so they can finish, then re-check.",
    );
  });
});
