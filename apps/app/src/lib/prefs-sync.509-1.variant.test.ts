// HV-15 variant of benchmarks/escapes/509-1-error-read-as-empty: the web `preferences.get()`
// answers `null` ("no row") when `getAuthedUser()` fails (offline, a 5xx, a mid-refresh 401),
// because `getAuthedUser` swallows the error. So a new device that boots offline seeds its
// defaults as this person's with a fresh stamp, and on reconnect pushes them over the
// account's real preferences. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/lib/prefs-sync.509-1.variant.test.ts
import { beforeEach, describe, expect, it, rs } from "@rstest/core";

const h = rs.hoisted(() => ({
  online: false,
  user: "00000000-0000-4000-8000-0000000000b1",
  // The account's real, older-stamped row in the cloud.
  row: {
    appearance: {},
    appearance_updated_at: null,
    focus: {},
    focus_updated_at: null,
    calendar: {},
    calendar_updated_at: null,
    email: {},
    email_updated_at: null,
    preferences: { landingView: "email" },
    preferences_updated_at: "2026-10-01T12:00:00.000Z",
  } as Record<string, unknown>,
  pushes: [] as Record<string, unknown>[],
  runtime: null as unknown,
}));

rs.mock("@supabase/supabase-js", () => {
  const offline = { message: "TypeError: Failed to fetch", code: "" };
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve(
                h.online ? { data: h.row, error: null } : { data: null, error: offline },
              ).then(resolve);
          }
          return () => chain();
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const auth = {
    onAuthStateChange: noop,
    getUser: async () =>
      h.online
        ? { data: { user: { id: h.user } }, error: null }
        : { data: { user: null }, error: { name: "AuthRetryableFetchError", message: "offline" } },
  };
  const client = new Proxy(
    {
      from: () => chain(),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (!h.online) return { data: null, error: offline };
        if (fn !== "prefs_op_set") return { data: null, error: null };
        h.pushes.push(args);
        const domain = args.p_domain as string;
        const stampKey = `${domain}_updated_at`;
        const savedAt = h.row[stampKey] as string | null;
        if (!savedAt || Date.parse(args.p_updated_at as string) > Date.parse(savedAt)) {
          h.row = { ...h.row, [domain]: args.p_value, [stampKey]: args.p_updated_at };
        }
        return { data: h.row, error: null };
      },
      auth: new Proxy(auth, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

rs.mock("./runtime", () => ({
  initRuntime: async () => h.runtime,
  getRuntime: () => h.runtime,
}));

import { getSyncMeta, invalidateCloudPrefs, reconcileDomain } from "./prefs-sync";
import { webPreferences } from "./runtime.web.preferences";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt(
  "HV-15 variant 509-1: an offline boot reads prefs as 'no row' and later overwrites them",
  () => {
    beforeEach(() => {
      localStorage.clear();
      invalidateCloudPrefs();
      h.runtime = { preferences: webPreferences.preferences };
    });

    it("a new device that boots offline never pushes its defaults over the account's prefs", async () => {
      const reconcile = () =>
        reconcileDomain({
          domain: "preferences",
          userId: h.user,
          localValue: { landingView: "home" }, // this new device's defaults
          defaults: { landingView: "home" },
          sanitizeCloud: (raw) => raw,
          apply: () => {},
        });

      // Signed in (session on the device), but the network is down at boot.
      h.online = false;
      const first = await reconcile();
      const claimedBy = getSyncMeta("preferences").userId;

      // Back online: the retry reads the account's real row and keeps it.
      h.online = true;
      invalidateCloudPrefs();
      await reconcile();
      expect(h.row.preferences).toEqual({ landingView: "email" });
      expect(h.pushes).toHaveLength(0);
      // The offline read failed: it is not "no row", so nothing was claimed for this person.
      expect(first).toBe("error");
      expect(claimedBy).toBeNull();
    });
  },
);
