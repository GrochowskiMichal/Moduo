// The preference domains' failed-read contract, as a property (HV-17, AC24;
// the #509 bug where a failed cloud read passed for "no row" and seeded
// defaults over the account's prefs). Random reconciles (the read failing or
// not), edits on this device (the push failing or not), saves from another
// device and someone else using this browser run against a reference of the
// contract in `reconcileDomain`'s comment. The outbox's own property is
// `sync/outbox.property.test.ts`. Seeds are fixed; set FC_SEED / FC_RUNS to
// explore.

import { describe, expect, it, rs } from "@rstest/core";
import fc from "fast-check";

// prefs-sync reads the cloud row through the runtime: a stand-in that can fail.
const prefs = rs.hoisted(() => {
  const state: {
    cloud: Record<string, unknown> | null;
    failRead: boolean;
    failWrite: boolean;
  } = { cloud: null, failRead: false, failWrite: false };
  const runtime = {
    preferences: {
      get: async () => {
        if (state.failRead) throw new TypeError("Failed to fetch");
        return state.cloud;
      },
      // prefs_op_set: keeps the newer stamp (or takes a domain never saved).
      setDomain: async (domain: string, value: Record<string, unknown>, updatedAt: string) => {
        if (state.failWrite) throw new TypeError("Failed to fetch");
        const stampKey = `${domain}UpdatedAt`;
        const row: Record<string, unknown> = state.cloud ?? {};
        const savedAt = row[stampKey] as string | null | undefined;
        if (!row[domain] || !savedAt || Date.parse(updatedAt) > Date.parse(savedAt)) {
          state.cloud = { ...row, [domain]: value, [stampKey]: updatedAt };
        } else {
          state.cloud = row;
        }
        return state.cloud;
      },
    },
  };
  return { state, runtime };
});
rs.mock("./runtime", () => ({
  initRuntime: async () => prefs.runtime,
  getRuntime: () => prefs.runtime,
}));

import {
  getSyncMeta,
  invalidateCloudPrefs,
  nowIso,
  pushDomain,
  reconcileDomain,
  setSyncMeta,
} from "./prefs-sync";

const SEED = Number(process.env.FC_SEED ?? 1709);
const PREF_RUNS = Number(process.env.FC_RUNS ?? 200);
const A = "u-a";
const B = "u-b";

type PrefModel = { local: Record<string, unknown>; applied: number };

const DOMAIN = "appearance" as const;
const DEFAULTS = { theme: "default" };

type PrefCmd = fc.AsyncCommand<PrefModel, object>;

const cloudOf = () => {
  const row = prefs.state.cloud;
  return {
    value: (row?.[DOMAIN] as Record<string, unknown> | undefined) ?? null,
    at: (row?.[`${DOMAIN}UpdatedAt`] as string | undefined) ?? null,
  };
};
const ms = (iso: string | null) => (iso ? Date.parse(iso) : 0);

class Reconcile implements PrefCmd {
  constructor(readonly readFails: boolean) {}
  check = () => true;
  async run(m: PrefModel) {
    invalidateCloudPrefs();
    prefs.state.failRead = this.readFails;
    const cloudBefore = cloudOf();
    const metaBefore = getSyncMeta(DOMAIN);
    const localBefore = m.local;
    const appliedBefore = m.applied;
    const outcome = await reconcileDomain({
      domain: DOMAIN,
      userId: A,
      localValue: m.local,
      defaults: DEFAULTS,
      sanitizeCloud: (raw) => raw,
      apply: (value) => {
        m.local = value;
        m.applied += 1;
      },
    });
    prefs.state.failRead = false;
    const cloudAfter = cloudOf();
    if (this.readFails) {
      // A failed read touches nothing: not the cloud, not the device, not the meta.
      expect(outcome).toBe("error");
      expect(cloudAfter).toEqual(cloudBefore);
      expect(m.applied).toBe(appliedBefore);
      expect(m.local).toBe(localBefore);
      expect(getSyncMeta(DOMAIN)).toEqual(metaBefore);
      return;
    }
    expect(outcome).toBe("ok");
    if (cloudBefore.value && Object.keys(cloudBefore.value).length > 0 && cloudBefore.at) {
      const localNewer = metaBefore.userId === A && ms(metaBefore.updatedAt) > ms(cloudBefore.at);
      if (localNewer) {
        // This device holds A's newer edit: it goes up.
        expect(cloudAfter.value).toEqual(localBefore);
      } else {
        // The account's saved copy stands, and the device takes it.
        expect(cloudAfter).toEqual(cloudBefore);
        expect(m.local).toEqual(cloudBefore.value);
      }
    }
  }
  toString = () => `Reconcile(${this.readFails ? "read fails" : "read ok"})`;
}

/** A edits on this device (`pushLocalChange`), maybe with the push failing. */
class LocalEdit implements PrefCmd {
  constructor(
    readonly theme: string,
    readonly pushFails: boolean,
  ) {}
  check = () => true;
  async run(m: PrefModel) {
    const updatedAt = nowIso();
    m.local = { theme: this.theme };
    setSyncMeta(DOMAIN, { userId: A, updatedAt, dirty: true });
    prefs.state.failWrite = this.pushFails;
    const res = await pushDomain(DOMAIN, m.local, updatedAt);
    prefs.state.failWrite = false;
    // A push that didn't get through says so: the edit stays dirty and goes on reconnect.
    if (this.pushFails) expect(res.kind).toBe("failed");
    if (res.kind === "newer") {
      m.local = res.value;
      setSyncMeta(DOMAIN, { userId: A, updatedAt: res.updatedAt, dirty: false });
    } else setSyncMeta(DOMAIN, { userId: A, updatedAt, dirty: res.kind === "failed" });
  }
  toString = () => `LocalEdit(${this.theme}${this.pushFails ? ", push fails" : ""})`;
}

/** A saves from another device. */
class OtherDeviceEdit implements PrefCmd {
  constructor(readonly theme: string) {}
  check = () => true;
  async run() {
    await prefs.runtime.preferences.setDomain(DOMAIN, { theme: this.theme }, nowIso());
  }
  toString = () => `OtherDeviceEdit(${this.theme})`;
}

/** Someone else (or nobody, signed out) used this browser: the local copy isn't A's. */
class LocalOwner implements PrefCmd {
  constructor(
    readonly owner: "other" | "anonymous",
    readonly theme: string,
  ) {}
  check = () => true;
  async run(m: PrefModel) {
    m.local = { theme: this.theme };
    setSyncMeta(DOMAIN, {
      userId: this.owner === "other" ? B : null,
      updatedAt: nowIso(),
      dirty: false,
    });
  }
  toString = () => `LocalOwner(${this.owner}, ${this.theme})`;
}

const theme = fc.constantFrom("dark", "light", "sepia", "ocean");
const prefArbs = [
  fc.boolean().map((fails) => new Reconcile(fails)),
  fc.boolean().map((fails) => new Reconcile(fails)),
  fc.tuple(theme, fc.boolean()).map(([t, f]) => new LocalEdit(t, f)),
  theme.map((t) => new OtherDeviceEdit(t)),
  fc
    .tuple(fc.constantFrom("other" as const, "anonymous" as const), theme)
    .map(([o, t]) => new LocalOwner(o, t)),
];

describe("preference domains: model-based property (HV-17)", () => {
  it("a failed read changes nothing, and the account's saved copy is never seeded over", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(theme, { nil: null }),
        fc.commands(prefArbs, { maxCommands: 25 }),
        async (cloudTheme, cmds) => {
          localStorage.clear();
          invalidateCloudPrefs();
          prefs.state.cloud = cloudTheme
            ? {
                [DOMAIN]: { theme: cloudTheme },
                [`${DOMAIN}UpdatedAt`]: "2026-10-01T09:00:00.000Z",
              }
            : null;
          prefs.state.failRead = false;
          prefs.state.failWrite = false;
          const m: PrefModel = { local: { ...DEFAULTS }, applied: 0 };
          await fc.asyncModelRun(() => ({ model: m, real: {} }), cmds);
        },
      ),
      { seed: SEED, numRuns: PREF_RUNS, endOnFailure: true },
    );
  });
});
