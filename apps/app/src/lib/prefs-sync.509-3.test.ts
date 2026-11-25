// Regression test (un-parked HV-15 proof) for a variant of benchmarks/escapes/509-3-signout-wipes-outbox: another person signing in
// overwrites a signed-out person's unsynced (dirty) preferences, so their offline change never
// reaches their account. Fails with the fix reverted.
// Run: bun run --cwd apps/app test src/lib/prefs-sync.509-3.test.ts
import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

// One user_preferences row per person; `signedIn` is whose session the runtime speaks for.
// setDomain merges the way prefs_op_set does: only a newer stamp (or a never-saved domain) lands.
const h = rs.hoisted(() => {
  const state: {
    signedIn: string | null;
    offline: boolean;
    rows: Map<string, Record<string, unknown>>;
    authListener: ((event: string, session: { user: { id: string } } | null) => void) | null;
  } = { signedIn: null, offline: false, rows: new Map(), authListener: null };
  const runtime = {
    auth: {
      onAuthStateChange(cb: NonNullable<typeof state.authListener>) {
        state.authListener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    preferences: {
      get: async () => {
        if (state.offline) throw new Error("TypeError: Failed to fetch");
        return state.signedIn ? (state.rows.get(state.signedIn) ?? null) : null;
      },
      setDomain: async (domain: string, value: Record<string, unknown>, updatedAt: string) => {
        if (state.offline) throw new Error("TypeError: Failed to fetch");
        if (!state.signedIn) return null;
        const stampKey = `${domain}UpdatedAt`;
        const row = state.rows.get(state.signedIn) ?? {};
        const saved = row[domain] as Record<string, unknown> | null | undefined;
        const savedAt = row[stampKey] as string | null | undefined;
        const neverSaved = !saved || Object.keys(saved).length === 0 || !savedAt;
        const next =
          neverSaved || Date.parse(updatedAt) > Date.parse(savedAt as string)
            ? { ...row, [domain]: value, [stampKey]: updatedAt }
            : row;
        state.rows.set(state.signedIn, next);
        return next;
      },
    },
  };
  return { state, runtime };
});

rs.mock("./runtime", () => ({
  initRuntime: async () => h.runtime,
  getRuntime: () => h.runtime,
}));

import {
  forgetParkedPrefs,
  getSyncMeta,
  invalidateCloudPrefs,
  reconcileDomain,
  setSyncMeta,
  type SyncDomain,
  unsyncedPrefsKeys,
  useDomainSync,
} from "./prefs-sync";

beforeEach(() => {
  localStorage.clear();
  h.state.signedIn = null;
  h.state.offline = false;
  h.state.authListener = null;
  h.state.rows = new Map();
  invalidateCloudPrefs();
});

describe("HV-15 variant 509-3: a user switch drops the previous person's unsynced preferences", () => {
  it("A's offline preferences change reaches A's account after B used the browser in between", async () => {
    // A's account copy, saved yesterday.
    h.state.rows.set("user-A", {
      preferences: { landingView: "home" },
      preferencesUpdatedAt: "2026-10-20T09:00:00.000Z",
    });
    // B's account copy.
    h.state.rows.set("user-B", {
      preferences: { landingView: "chat" },
      preferencesUpdatedAt: "2026-10-20T10:00:00.000Z",
    });

    // The device's mirror: A changed their landing view while offline; the push failed, so the
    // change is A's and dirty (exactly what pushLocalChange leaves after a failed push).
    let local: Record<string, unknown> = { landingView: "tasks" };
    setSyncMeta("preferences", {
      userId: "user-A",
      updatedAt: "2026-10-21T08:00:00.000Z",
      dirty: true,
    });
    const apply = (value: Record<string, unknown>) => {
      local = value;
    };
    const reconcileAs = async (userId: string) => {
      h.state.signedIn = userId;
      invalidateCloudPrefs();
      await reconcileDomain({
        domain: "preferences",
        userId,
        localValue: local,
        defaults: { landingView: "home" },
        sanitizeCloud: (raw) => raw,
        apply,
      });
    };

    // A is signed out (auth-js on its own, or Log out, which warns only about Tasks/Chat), and
    // B signs in on this browser: B's reconcile runs.
    await reconcileAs("user-B");
    // B's own copy is what B sees (privacy holds).
    expect(local).toEqual({ landingView: "chat" });

    // Later A signs back in here.
    await reconcileAs("user-A");

    // A's offline change must have gone out to A's account.
    expect(h.state.rows.get("user-A")?.preferences).toEqual({ landingView: "tasks" });
  });

  // Calendar and email keep one copy per person on the device (`moduo:calendar:prefs:<id>`,
  // `readEmailPrefs(id)`), and their hooks mount with the newly signed-in person's copy. So
  // what B's reconcile holds as "local" is B's, not A's: the parked change must be A's own.
  const perPerson: [SyncDomain, Record<string, unknown>, Record<string, unknown>][] = [
    ["calendar", { workStartMinute: 420 }, { workStartMinute: 600 }],
    ["email", { senderOverrides: { "a@x.io": "feed" } }, { senderOverrides: { "b@x.io": "fyi" } }],
  ];
  for (const [domain, aChange, bCopy] of perPerson) {
    it(`A's offline ${domain} change reaches A's account, not B's copy (per-person mirror)`, async () => {
      const stamp = `${domain}UpdatedAt`;
      h.state.rows.set("user-A", { [domain]: { old: true }, [stamp]: "2026-10-20T09:00:00.000Z" });
      h.state.rows.set("user-B", { [domain]: bCopy, [stamp]: "2026-10-20T10:00:00.000Z" });
      // Each person's own copy on this device; A's holds the unsynced change.
      const copies = new Map<string, Record<string, unknown>>([
        ["user-A", aChange],
        ["user-B", bCopy],
      ]);
      setSyncMeta(domain, { userId: "user-A", updatedAt: "2026-10-21T08:00:00.000Z", dirty: true });
      const reconcileAs = async (userId: string) => {
        h.state.signedIn = userId;
        invalidateCloudPrefs();
        await reconcileDomain({
          domain,
          userId,
          // The hook has already switched to the signed-in person's copy.
          localValue: copies.get(userId) ?? {},
          localValueOf: (id) => copies.get(id) ?? null,
          defaults: {},
          sanitizeCloud: (raw) => raw,
          apply: (value, id) => copies.set(id, value),
        });
      };

      await reconcileAs("user-B");
      expect(copies.get("user-B")).toEqual(bCopy);
      await reconcileAs("user-A");

      expect(h.state.rows.get("user-A")?.[domain]).toEqual(aChange);
      expect(h.state.rows.get("user-B")?.[domain]).toEqual(bCopy);
    });
  }

  it("deleting A's account forgets A's parked change on this device", async () => {
    h.state.rows.set("user-B", {
      preferences: { landingView: "chat" },
      preferencesUpdatedAt: "2026-10-20T10:00:00.000Z",
    });
    setSyncMeta("preferences", {
      userId: "user-A",
      updatedAt: "2026-10-21T08:00:00.000Z",
      dirty: true,
    });
    h.state.signedIn = "user-B";
    await reconcileDomain({
      domain: "preferences",
      userId: "user-B",
      localValue: { landingView: "tasks" },
      defaults: {},
      sanitizeCloud: (raw) => raw,
      apply: () => {},
    });
    expect(localStorage.getItem("moduo.preferences.sync.parked")).toContain("user-A");

    forgetParkedPrefs("user-A");

    expect(localStorage.getItem("moduo.preferences.sync.parked")).toBeNull();
    expect(unsyncedPrefsKeys()).not.toContain("moduo.preferences.sync.parked");
  });

  it("A's offline calendar change survives B signing in offline and editing their own", async () => {
    h.state.rows.set("user-A", {
      calendar: { workStartMinute: 480 },
      calendarUpdatedAt: "2026-10-20T09:00:00.000Z",
    });
    const copies = new Map<string, Record<string, unknown>>([
      ["user-A", { workStartMinute: 420 }], // A's unsynced change
    ]);
    setSyncMeta("calendar", {
      userId: "user-A",
      updatedAt: "2026-10-21T08:00:00.000Z",
      dirty: true,
    });

    // B signs in while still offline: the reconcile read fails, so nothing is parked yet.
    h.state.offline = true;
    h.state.signedIn = "user-B";
    const hook = renderHook(() =>
      useDomainSync({
        domain: "calendar",
        getLocalSyncable: () => copies.get("user-B") ?? {},
        localValueOf: (id) => copies.get(id) ?? null,
        defaults: {},
        sanitizeCloud: (raw) => raw,
        apply: (value, id) => copies.set(id, value),
      }),
    );
    await waitFor(() => expect(h.state.authListener).not.toBeNull());
    act(() => h.state.authListener?.("SIGNED_IN", { user: { id: "user-B" } }));
    await new Promise((r) => setTimeout(r, 0));

    // B edits a calendar pref (offline): their own copy, stamped as theirs.
    copies.set("user-B", { workStartMinute: 600 });
    act(() => hook.result.current.pushLocalChange({ workStartMinute: 600 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(getSyncMeta("calendar").userId).toBe("user-B");
    hook.unmount();

    // A returns, online.
    h.state.offline = false;
    h.state.signedIn = "user-A";
    invalidateCloudPrefs();
    await reconcileDomain({
      domain: "calendar",
      userId: "user-A",
      localValue: copies.get("user-A") ?? {},
      localValueOf: (id) => copies.get(id) ?? null,
      defaults: {},
      sanitizeCloud: (raw) => raw,
      apply: (value, id) => copies.set(id, value),
    });

    expect(h.state.rows.get("user-A")?.calendar).toEqual({ workStartMinute: 420 });
  });
});
