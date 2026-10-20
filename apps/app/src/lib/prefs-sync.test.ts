import { beforeEach, describe, expect, it, rs } from "@rstest/core";

// A stand-in cloud row + a mock runtime.preferences that records every write as
// a patch and merges it into the row the way prefs_op_set does: only when the
// stamp is newer, or the domain was never saved. Hoisted so rs.mock can close
// over it. The reconcile/push engine talks only to runtime.preferences.get/setDomain.
const h = rs.hoisted(() => {
  const emptyRow = () => ({
    appearance: null,
    appearanceUpdatedAt: null,
    focus: null,
    focusUpdatedAt: null,
    calendar: null,
    calendarUpdatedAt: null,
    email: null,
    emailUpdatedAt: null,
    preferences: null,
    preferencesUpdatedAt: null,
  });
  const state: {
    cloud: Record<string, unknown> | null;
    setPatches: Record<string, unknown>[];
    getError: Error | null;
  } = { cloud: null, setPatches: [], getError: null };
  const runtime = {
    preferences: {
      get: async () => {
        if (state.getError) throw state.getError;
        return state.cloud;
      },
      setDomain: async (domain: string, value: Record<string, unknown>, updatedAt: string) => {
        const stampKey = `${domain}UpdatedAt`;
        state.setPatches.push({ [domain]: value, [stampKey]: updatedAt });
        const row: Record<string, unknown> = state.cloud ?? emptyRow();
        const saved = row[domain] as Record<string, unknown> | null;
        const savedAt = row[stampKey] as string | null;
        const neverSaved = !saved || Object.keys(saved).length === 0 || !savedAt;
        if (neverSaved || Date.parse(updatedAt) > Date.parse(savedAt)) {
          state.cloud = { ...row, [domain]: value, [stampKey]: updatedAt };
        } else {
          state.cloud = row;
        }
        return state.cloud;
      },
    },
  };
  return { state, runtime, emptyRow };
});

rs.mock("./runtime", () => ({
  initRuntime: async () => h.runtime,
  getRuntime: () => h.runtime,
}));

import {
  getSyncMeta,
  invalidateCloudPrefs,
  isDomainReconciled,
  nowIso,
  pushDomain,
  reconcileDomain,
  setDomainReconciledForTest,
  setSyncMeta,
} from "./prefs-sync";

beforeEach(() => {
  localStorage.clear();
  h.state.cloud = null;
  h.state.setPatches = [];
  h.state.getError = null;
  invalidateCloudPrefs();
  setDomainReconciledForTest("preferences", null);
});

describe("preferences domain — prefs-sync routing (DF-19f)", () => {
  it("pushDomain('preferences') writes the preferences column + its timestamp", async () => {
    const ts = nowIso();
    const res = await pushDomain("preferences", { landingView: "email" }, ts);
    expect(res).toEqual({ kind: "saved" });
    expect(h.state.setPatches).toContainEqual({
      preferences: { landingView: "email" },
      preferencesUpdatedAt: ts,
    });
  });

  it("reconcile seeds local → cloud when the domain has never synced", async () => {
    const applied: unknown[] = [];
    const localValue = { landingView: "tasks", motion: "reduced" };
    await reconcileDomain({
      domain: "preferences",
      userId: "user-A",
      localValue,
      defaults: { landingView: "home" },
      sanitizeCloud: (raw) => raw,
      apply: (v) => applied.push(v),
    });
    // Anonymous local → adopted into this user's fresh row via a push; nothing applied.
    expect(h.state.setPatches.at(-1)?.preferences).toEqual(localValue);
    expect(applied).toHaveLength(0);
  });

  it("reconcile adopts the cloud value when it is newer (LWW)", async () => {
    h.state.cloud = {
      ...h.emptyRow(),
      preferences: { landingView: "email" },
      preferencesUpdatedAt: "2026-07-12T12:00:00.000Z",
    };
    // Local owned by this user but older.
    setSyncMeta("preferences", {
      userId: "user-B",
      updatedAt: "2026-07-10T00:00:00.000Z",
      dirty: false,
    });
    const applied: unknown[] = [];
    await reconcileDomain({
      domain: "preferences",
      userId: "user-B",
      localValue: { landingView: "home" },
      defaults: { landingView: "home" },
      sanitizeCloud: (raw) => raw,
      apply: (v) => applied.push(v),
    });
    expect(applied).toEqual([{ landingView: "email" }]);
    expect(h.state.setPatches).toHaveLength(0); // cloud won — no push
  });

  it("reconcile pushes the local value when it is newer than cloud (offline edit wins)", async () => {
    h.state.cloud = {
      ...h.emptyRow(),
      preferences: { landingView: "notes" },
      preferencesUpdatedAt: "2026-07-10T00:00:00.000Z",
    };
    const localTs = "2026-07-12T12:00:00.000Z";
    setSyncMeta("preferences", { userId: "user-C", updatedAt: localTs, dirty: true });
    const applied: unknown[] = [];
    await reconcileDomain({
      domain: "preferences",
      userId: "user-C",
      localValue: { landingView: "contacts" },
      defaults: { landingView: "home" },
      sanitizeCloud: (raw) => raw,
      apply: (v) => applied.push(v),
    });
    expect(h.state.setPatches.at(-1)).toEqual({
      preferences: { landingView: "contacts" },
      preferencesUpdatedAt: localTs,
    });
    expect(applied).toHaveLength(0);
  });

  it("a failed cloud read applies and pushes nothing (it is not 'no row')", async () => {
    // The account has real prefs, but this read fails (network, 5xx, RLS hiccup).
    h.state.cloud = {
      ...h.emptyRow(),
      preferences: { landingView: "email" },
      preferencesUpdatedAt: "2026-07-12T12:00:00.000Z",
    };
    h.state.getError = new Error("network down");
    // Local belongs to a different prior user: the "no row" branch would reset to
    // defaults and push them over the account's real row.
    setSyncMeta("preferences", { userId: "user-old", updatedAt: null, dirty: false });
    const applied: unknown[] = [];
    const outcome = await reconcileDomain({
      domain: "preferences",
      userId: "user-D",
      localValue: { landingView: "tasks" },
      defaults: { landingView: "home" },
      sanitizeCloud: (raw) => raw,
      apply: (v) => applied.push(v),
    });
    expect(outcome).toBe("error");
    expect(h.state.setPatches).toHaveLength(0);
    expect(applied).toHaveLength(0);
    expect(getSyncMeta("preferences").userId).toBe("user-old");
    expect(isDomainReconciled("preferences", "user-D")).toBe(false);

    // The retry, once the read works, adopts the account's real value.
    h.state.getError = null;
    const retried = await reconcileDomain({
      domain: "preferences",
      userId: "user-D",
      localValue: { landingView: "tasks" },
      defaults: { landingView: "home" },
      sanitizeCloud: (raw) => raw,
      apply: (v) => applied.push(v),
    });
    expect(retried).toBe("ok");
    expect(applied).toEqual([{ landingView: "email" }]);
    expect(h.state.setPatches).toHaveLength(0);
    expect(isDomainReconciled("preferences", "user-D")).toBe(true);
  });
  it("pushDomain reports the newer copy when another device saved one since", async () => {
    h.state.cloud = {
      ...h.emptyRow(),
      preferences: { landingView: "email" },
      preferencesUpdatedAt: "2026-07-12T12:00:00.000Z",
    };
    const res = await pushDomain(
      "preferences",
      { landingView: "tasks" },
      "2026-07-11T00:00:00.000Z",
    );
    expect(res).toEqual({
      kind: "newer",
      value: { landingView: "email" },
      updatedAt: "2026-07-12T12:00:00.000Z",
    });
    expect(h.state.cloud?.preferences).toEqual({ landingView: "email" });
  });

  it("a reconcile push that loses to a newer copy adopts that copy", async () => {
    // The read saw an older cloud copy, but a newer one lands before the push.
    h.state.cloud = {
      ...h.emptyRow(),
      preferences: { landingView: "notes" },
      preferencesUpdatedAt: "2026-07-10T00:00:00.000Z",
    };
    const localTs = "2026-07-11T00:00:00.000Z";
    setSyncMeta("preferences", { userId: "user-E", updatedAt: localTs, dirty: true });
    const applied: unknown[] = [];
    const read = h.runtime.preferences.get;
    h.runtime.preferences.get = async () => {
      const seen = await read();
      h.state.cloud = {
        ...h.emptyRow(),
        preferences: { landingView: "email" },
        preferencesUpdatedAt: "2026-07-12T00:00:00.000Z",
      };
      return seen;
    };
    try {
      await reconcileDomain({
        domain: "preferences",
        userId: "user-E",
        localValue: { landingView: "contacts" },
        defaults: { landingView: "home" },
        sanitizeCloud: (raw) => raw,
        apply: (v) => applied.push(v),
      });
    } finally {
      h.runtime.preferences.get = read;
    }
    expect(applied).toEqual([{ landingView: "email" }]);
    expect(getSyncMeta("preferences")).toEqual({
      userId: "user-E",
      updatedAt: "2026-07-12T00:00:00.000Z",
      dirty: false,
    });
  });
});
