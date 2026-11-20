// HV-15 variant of benchmarks/escapes/509-3-signout-wipes-outbox: another person signing in
// overwrites a signed-out person's unsynced (dirty) preferences, so their offline change never
// reaches their account. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/lib/prefs-sync.509-3.variant.test.ts
import { beforeEach, describe, expect, it, rs } from "@rstest/core";

// One user_preferences row per person; `signedIn` is whose session the runtime speaks for.
// setDomain merges the way prefs_op_set does: only a newer stamp (or a never-saved domain) lands.
const h = rs.hoisted(() => {
  const state: {
    signedIn: string | null;
    rows: Map<string, Record<string, unknown>>;
  } = { signedIn: null, rows: new Map() };
  const runtime = {
    preferences: {
      get: async () => (state.signedIn ? (state.rows.get(state.signedIn) ?? null) : null),
      setDomain: async (domain: string, value: Record<string, unknown>, updatedAt: string) => {
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

import { invalidateCloudPrefs, reconcileDomain, setSyncMeta } from "./prefs-sync";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

beforeEach(() => {
  localStorage.clear();
  h.state.signedIn = null;
  h.state.rows = new Map();
  invalidateCloudPrefs();
});

hunt("HV-15 variant 509-3: a user switch drops the previous person's unsynced preferences", () => {
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
});
