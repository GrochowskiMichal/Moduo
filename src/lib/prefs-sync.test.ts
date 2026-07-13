import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in cloud row + a mock runtime.preferences that records every set() patch
// and merges it into the row (mimicking the upsert). Hoisted so vi.mock can close
// over it. The reconcile/push engine talks only to runtime.preferences.get/set.
const h = vi.hoisted(() => {
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
  } = { cloud: null, setPatches: [] };
  const runtime = {
    preferences: {
      get: async () => state.cloud,
      set: async (patch: Record<string, unknown>) => {
        state.setPatches.push(patch);
        state.cloud = { ...(state.cloud ?? emptyRow()), ...patch };
        return state.cloud;
      },
    },
  };
  return { state, runtime, emptyRow };
});

vi.mock("./runtime", () => ({
  initRuntime: async () => h.runtime,
  getRuntime: () => h.runtime,
}));

import {
  invalidateCloudPrefs,
  nowIso,
  pushDomain,
  reconcileDomain,
  setSyncMeta,
} from "./prefs-sync";

beforeEach(() => {
  localStorage.clear();
  h.state.cloud = null;
  h.state.setPatches = [];
  invalidateCloudPrefs();
});

describe("preferences domain — prefs-sync routing (DF-19f)", () => {
  it("pushDomain('preferences') writes the preferences column + its timestamp", async () => {
    const ts = nowIso();
    const ok = await pushDomain("preferences", { landingView: "email" }, ts);
    expect(ok).toBe(true);
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
});
