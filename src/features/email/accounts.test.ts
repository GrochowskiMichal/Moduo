import { describe, expect, it } from "@rstest/core";

import { accountSyncHealth, providerLabel, resolveAccountHues } from "./accounts";
import type { AccountStatus, SavedAccount } from "./model/email-types";

function account(id: string, status: AccountStatus, lastError: string | null = null): SavedAccount {
  return {
    id,
    provider: "gmail",
    email: `${id}@x.com`,
    lastSyncAt: "2026-07-29T10:00:00Z",
    status,
    lastError,
  };
}

describe("accountSyncHealth", () => {
  it("per-account sync error isolation", () => {
    const accounts = [
      account("a", "active"),
      account("b", "error", "uid_search_failed:timeout"),
      account("c", "active"),
      account("d", "reauth_required", "missing_account_secret"),
    ];

    const health = accountSyncHealth(accounts);

    // The engine's isolation is the `match` around each account's sync in
    // `email_sync_now` (Rust, unchanged by IM-2b). What this asserts is the read-side
    // half: a failing account is reported by name and never stands in for the healthy
    // ones, which keep listing.
    expect(health.active.map((a) => a.id)).toEqual(["a", "c"]);
    expect(health.broken.map((a) => a.id)).toEqual(["b", "d"]);

    // Only expired auth is reconnectable; a transient sync error is not — offering
    // "Reconnect" for it would be a dead end.
    expect(health.reconnectable.map((a) => a.id)).toEqual(["d"]);

    // Every account lands in exactly one of active/broken, so none is silently
    // dropped from the UI's accounting.
    expect(health.active.length + health.broken.length).toBe(accounts.length);
  });

  it("reports no breakage when every account is healthy, and no health when there are none", () => {
    const allGood = accountSyncHealth([account("a", "active"), account("b", "active")]);
    expect(allGood.broken).toEqual([]);
    expect(allGood.reconnectable).toEqual([]);

    const empty = accountSyncHealth([]);
    expect(empty).toEqual({ active: [], broken: [], reconnectable: [] });
  });

  it("treats every non-active status as broken, including ones added later", () => {
    // `status` is a union; this guards the partition against a new state being
    // silently classified as healthy.
    const health = accountSyncHealth([
      account("a", "error"),
      account("b", "reauth_required"),
      account("c", "syncing" as AccountStatus),
    ]);
    expect(health.active).toEqual([]);
    expect(health.broken.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps hue assignment and provider labels independent of sync health", () => {
    const accounts = [account("b", "error"), account("a", "active")];
    const hues = resolveAccountHues(accounts);
    // A broken account still gets its stable hue — the rail must not lose its dot.
    expect(hues.a).toBeTruthy();
    expect(hues.b).toBeTruthy();
    expect(hues.a).not.toBe(hues.b);
    expect(providerLabel("gmail")).toBe("Gmail");
  });
});
