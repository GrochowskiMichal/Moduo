// HV-15 variant of benchmarks/escapes/509-1-error-read-as-empty: the web `dashboard.get()`
// answers `null` ("no layout") when `getAuthedUser()` fails (offline, a 5xx, a mid-refresh
// 401), and `dashboard.save()` returns quietly. So a new device that opens Home offline seeds
// the default with a fresh stamp instead of a placeholder; back online it outranks the
// account's real layout and the next edit pushes it over the cloud row. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/lib/runtime.web.preferences.509-1.variant.test.ts
import { describe, expect, it, rs } from "@rstest/core";

const h = rs.hoisted(() => ({
  online: false,
  user: "00000000-0000-4000-8000-0000000000b2",
  // The account's real layout, saved yesterday on another device.
  row: {
    layout_data: {
      version: 1,
      pages: [
        { id: "home", widgets: [{ id: "mine", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
      ],
    },
    updated_at: "2026-11-02T09:00:00.000Z",
  } as { layout_data: unknown; updated_at: string },
}));

rs.mock("@supabase/supabase-js", () => {
  const offline = { message: "TypeError: Failed to fetch", code: "" };
  type Call = [string, unknown[]];
  const answer = (calls: Call[]) => {
    if (!h.online) return { data: null, error: offline };
    const upsert = calls.find(([m]) => m === "upsert");
    if (upsert) {
      const v = upsert[1][0] as { layout_data: unknown; updated_at: string };
      h.row = { layout_data: v.layout_data, updated_at: v.updated_at };
      return { data: null, error: null };
    }
    return { data: h.row, error: null };
  };
  const chain = (calls: Call[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve(answer(calls)).then(resolve);
          }
          return (...args: unknown[]) => {
            calls.push([String(prop), args]);
            return chain(calls);
          };
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
      from: () => chain([]),
      rpc: async () => ({ data: null, error: h.online ? null : offline }),
      auth: new Proxy(auth, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { createLayoutRepo } from "../features/dashboard/data/layout-repo";
import type { DashboardLayout } from "../features/dashboard/engine/types";
import type { ModuoRuntime } from "./runtime.types";
import { webPreferences } from "./runtime.web.preferences";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

const widgetIds = (l: DashboardLayout) => l.pages.flatMap((p) => p.widgets.map((w) => w.id));

hunt(
  "HV-15 variant 509-1: an offline Home reads the layout as 'none' and later overwrites it",
  () => {
    it("a new device that opens Home offline shows and keeps the account's layout once online", async () => {
      const ls = new Map<string, unknown>();
      const runtime = {
        localStore: {
          get: async (ns: string, key: string) => ls.get(`${ns}:${key}`) ?? null,
          set: async (ns: string, key: string, value: unknown) => {
            ls.set(`${ns}:${key}`, value);
          },
          remove: async (ns: string, key: string) => {
            ls.delete(`${ns}:${key}`);
          },
        },
        dashboard: webPreferences.dashboard,
      } as unknown as ModuoRuntime;
      const repo = createLayoutRepo(runtime, {
        now: () => "2026-11-03T08:00:00.000Z",
        debounceMs: 0,
      });

      // Signed in (session on the device), but the network is down when Home opens.
      h.online = false;
      await repo.load("w1");

      // The connection is back: the account's real layout must win.
      h.online = true;
      const loaded = await repo.load("w1");
      expect(widgetIds(loaded.layout)).toContain("mine");

      // The person edits Home: the real layout must still be in the cloud.
      await repo.save("w1", loaded.layout);
      await repo.flush();
      expect(widgetIds(h.row.layout_data as DashboardLayout)).toContain("mine");
    });
  },
);
