import { describe, expect, it } from "@rstest/core";

import {
  abort,
  type Analytics,
  type CanaryEnv,
  judge,
  run,
  type RunOptions,
  single,
  type Split,
  type State,
  withoutProbes,
} from "./canary";

const OLD = "00000000-old0-0000-0000-000000000000";
const NEW = "11111111-new1-1111-1111-111111111111";
const WORKER = "moduo-app-production";
const HOST = "https://app.moduo.app";
const API = "https://api.cloudflare.com/client/v4";

const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Content-Security-Policy-Report-Only": "default-src 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=()",
};

type World = {
  /** The Worker's deployments, newest last. */
  deployments: { id: string; versions: Split }[];
  /** Every POSTed split, in order. */
  posted: Split[];
  clock: number;
  /** The new version answers 500 from this time on (a spike mid-soak). */
  spikeAt?: number;
  /** The new version's build is broken from the start (smoke fails). */
  broken?: boolean;
  /** Requests without an override land on a random version (no Transform Rule). */
  noAffinity?: boolean;
  /** Analytics per version, or "denied" for a token without Account Analytics: Read. */
  analytics?: Record<string, { requests: number; errors: number }> | "denied";
  /** The first n unpinned /config.json requests answer 500 (a flake during the affinity check). */
  flakyConfig?: number;
  /** Called before each deployments read: lets a test deploy "by someone else". */
  onRead?: (w: World) => void;
};

function world(w: Partial<World> = {}): World {
  return {
    deployments: [{ id: "d0", versions: [{ version_id: OLD, percentage: 100 }] }],
    posted: [],
    clock: 1_800_000_000_000,
    ...w,
  };
}

function live(w: World) {
  return w.deployments[w.deployments.length - 1];
}

/** Which version answers a request: the override when it names a deployed version, else the split. */
function serving(w: World, headers: Headers, n: number): string {
  const o = headers.get("cloudflare-workers-version-overrides");
  const v = o?.match(/="([^"]+)"/)?.[1];
  const split = live(w).versions;
  if (v && split.some((s) => s.version_id === v)) return v;
  // With affinity this client always lands on the old version (its IP hashes there).
  if (!w.noAffinity) return split.length === 1 ? split[0].version_id : OLD;
  return n % 3 === 0 && split.some((s) => s.version_id === NEW && s.percentage > 0) ? NEW : OLD;
}

function fake(w: World): CanaryEnv["fetchFn"] {
  let n = 0;
  return async (url, init) => {
    const u = new URL(url);
    if (url.startsWith(`${API}/graphql`)) {
      if (w.analytics === "denied")
        return Response.json({ data: null, errors: [{ message: "not authorized" }] });
      const rows = Object.entries(w.analytics ?? {}).map(([v, c]) => ({
        sum: c,
        dimensions: { scriptVersion: v },
      }));
      return Response.json({
        data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } },
      });
    }
    if (url.startsWith(API)) {
      expect(u.pathname).toBe(`/client/v4/accounts/acc/workers/scripts/${WORKER}/deployments`);
      if ((init?.method ?? "GET") === "GET") {
        w.onRead?.(w);
        return Response.json({
          success: true,
          result: { deployments: [...w.deployments].reverse() },
        });
      }
      const body = JSON.parse(String(init?.body)) as { versions: Split; strategy: string };
      expect(body.strategy).toBe("percentage");
      expect(body.versions.reduce((a, v) => a + v.percentage, 0)).toBe(100);
      const d = { id: `d${w.deployments.length}`, versions: body.versions };
      w.deployments.push(d);
      w.posted.push(body.versions);
      return Response.json({ success: true, result: d });
    }

    // The host.
    const version = serving(w, new Headers(init?.headers), n++);
    const isNew = version === NEW;
    const build = isNew ? "newsha1" : "oldsha1";
    if (isNew && (w.broken || (w.spikeAt !== undefined && w.clock >= w.spikeAt)))
      return new Response("error code: 1101", { status: 500 });
    const path = u.pathname;
    const html = () =>
      new Response(
        `<html><head><script>window.__MODUO_CONFIG__={"supabaseUrl":"https://x.supabase.co"};</script><script src="/static/js/index.${build}.js"></script></head></html>`,
        { headers: { ...SEC, "Content-Type": "text/html", "Cache-Control": "no-cache" } },
      );
    if (path === "/config.json" && !init?.headers && w.flakyConfig && w.flakyConfig-- > 0)
      return new Response("error code: 1101", { status: 500 });
    if (path === "/config.json")
      return Response.json({ supabaseUrl: "https://x.supabase.co", build }, { headers: SEC });
    if (path.startsWith("/static/js/index."))
      return new Response("x", {
        headers: { ...SEC, "Content-Type": "application/javascript", "Cache-Control": "immutable" },
      });
    if (path.startsWith("/static/")) return new Response("Not found", { status: 404 });
    if (path.startsWith("/push-"))
      return new Response("x", {
        headers: { ...SEC, "Content-Type": "application/javascript", "Cache-Control": "no-cache" },
      });
    return html();
  };
}

function envFor(w: World, lines: string[] = []): CanaryEnv {
  return {
    accountId: "acc",
    token: "t",
    fetchFn: fake(w),
    now: () => w.clock,
    sleep: async (ms) => {
      w.clock += ms;
    },
    log: (l) => lines.push(l),
  };
}

const OPTS: RunOptions = {
  worker: WORKER,
  version: NEW,
  url: HOST,
  build: "newsha1",
  percent: 10,
  minutes: 15,
  intervalSeconds: 30,
  expect: {},
  old: [],
  withoutAffinity: "promote",
};

const at = (p: number): Split =>
  p >= 100
    ? [{ version_id: NEW, percentage: 100 }]
    : [
        { version_id: NEW, percentage: p },
        { version_id: OLD, percentage: 100 - p },
      ];
const OLD_100: Split = [{ version_id: OLD, percentage: 100 }];

describe("judge", () => {
  const a = (cr: number, ce: number, sr: number, se: number): Analytics => ({
    canary: { requests: cr, errors: ce },
    stable: { requests: sr, errors: se },
  });

  it("two failed probe rounds in a row are a spike; one is a flake", () => {
    expect(judge(1, null).spike).toBe(false);
    expect(judge(2, null).spike).toBe(true);
  });

  it("the canary's own probe requests are taken out before judging", () => {
    // 30 rounds = 90 probe requests; 100 - 90 = 10 user requests, too few to say.
    expect(judge(0, withoutProbes(a(100, 3, 1000, 0), 30)).spike).toBe(false);
    expect(judge(0, withoutProbes(a(190, 3, 1000, 0), 30)).spike).toBe(true);
  });

  it("a version at 0% next to one at 100% is a single deployment", () => {
    expect(
      single({
        id: "d",
        versions: [
          { version_id: OLD, percentage: 100 },
          { version_id: NEW, percentage: 0 },
        ],
      }),
    ).toBe(OLD);
    expect(single({ id: "d", versions: at(10) })).toBeNull();
  });

  it("an error rate over max(2%, 2x the old version's) on 20+ requests is a spike", () => {
    expect(judge(0, a(100, 3, 1000, 0)).spike).toBe(true); // 3% > 2%
    expect(judge(0, a(100, 2, 1000, 0)).spike).toBe(false); // 2% is not over 2%
    expect(judge(0, a(100, 5, 1000, 30)).spike).toBe(false); // 5% vs old 3% → limit 6%
    expect(judge(0, a(100, 7, 1000, 30)).spike).toBe(true);
    expect(judge(0, a(19, 19, 1000, 0)).spike).toBe(false); // too few requests to say
  });
});

describe("run", () => {
  it("healthy: 0% smoke, 10% soak for 15 minutes, then 100%", async () => {
    const w = world({
      analytics: { [NEW]: { requests: 200, errors: 1 }, [OLD]: { requests: 1800, errors: 9 } },
    });
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("promoted");
    expect(w.posted).toEqual([at(0), at(10), at(100)]);
    expect(w.clock - 1_800_000_000_000).toBeGreaterThanOrEqual(15 * 60_000);
    expect(r.report.join("\n")).toMatch(/Promoted 11111111 to 100%/);
  });

  it("AC23: an error spike mid-soak rolls back to the old version by itself", async () => {
    const w = world();
    w.spikeAt = w.clock + 5 * 60_000;
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("rolled-back-soak");
    expect(w.posted).toEqual([at(0), at(10), OLD_100]);
    // Two 30 s rounds after the spike, not the whole 15 minutes.
    expect(w.clock - 1_800_000_000_000).toBeLessThan(7 * 60_000);
    expect(r.report.join("\n")).toMatch(/Spike after \d+ s: 2 probe rounds in a row failed/);
  });

  it("an analytics spike rolls back even when the probes pass", async () => {
    const w = world({
      analytics: { [NEW]: { requests: 100, errors: 10 }, [OLD]: { requests: 900, errors: 0 } },
    });
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("rolled-back-soak");
    expect(w.posted).toEqual([at(0), at(10), OLD_100]);
    expect(r.report.join("\n")).toMatch(/error rate 10\.3% over 97 requests/);
  });

  it("a broken build fails the 0% smoke and never reaches users", async () => {
    const w = world({ broken: true });
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("rolled-back-smoke");
    expect(w.posted).toEqual([at(0), OLD_100]);
  });

  it("without analytics access the probes decide alone, and the report says so", async () => {
    const w = world({ analytics: "denied" });
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("promoted");
    expect(r.report.join("\n")).toMatch(/analytics unavailable/);
  });

  it("without version affinity it promotes at once instead of serving mixed builds", async () => {
    const w = world({ noAffinity: true });
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("promoted-without-soak");
    expect(w.posted).toEqual([at(0), at(10), at(100)]);
    expect(r.report.join("\n")).toMatch(/No version affinity/);
  });

  it("a failed request during the affinity check is not 'no affinity'", async () => {
    const w = world({ flakyConfig: 3 });
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("promoted");
    expect(w.posted).toEqual([at(0), at(10), at(100)]);
  });

  it("a cancelled job makes no further change", async () => {
    const w = world();
    const e = envFor(w);
    let reads = 0;
    w.onRead = () => {
      reads++;
    };
    const r = await run(OPTS, { ...e, stopped: () => reads >= 3 });
    expect(r.outcome).toBe("left-alone");
    expect(w.posted).toEqual([at(0), at(10)]);
  });

  it("without affinity, --without-affinity soak still soaks (the staging rehearsal)", async () => {
    const w = world({ noAffinity: true });
    w.spikeAt = w.clock + 2 * 60_000;
    const r = await run({ ...OPTS, withoutAffinity: "soak" }, envFor(w));
    expect(r.outcome).toBe("rolled-back-soak");
  });

  it("refuses to start on a split deployment and changes nothing", async () => {
    const w = world({ deployments: [{ id: "d0", versions: at(10) }] });
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("refused");
    expect(w.posted).toEqual([]);
  });

  it("leaves the Worker alone when someone else deploys mid-soak", async () => {
    const w = world();
    let reads = 0;
    w.onRead = (x) => {
      // The 4th read is before the final promote: by then a staging deploy replaced the split.
      if (++reads === 4)
        x.deployments.push({ id: "other", versions: [{ version_id: "z", percentage: 100 }] });
    };
    const r = await run(OPTS, envFor(w));
    expect(r.outcome).toBe("left-alone");
    expect(w.posted).toEqual([at(0), at(10)]);
    expect(live(w).id).toBe("other");
  });

  it("writes its state, so a cancelled run can be undone", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const path = join(mkdtempSync(join(tmpdir(), "canary-")), "state.json");
    const w = world();
    await run({ ...OPTS, statePath: path }, envFor(w));
    const s = JSON.parse(readFileSync(path, "utf8")) as State;
    expect(s).toMatchObject({ stable: OLD, canary: NEW, outcome: "promoted", ours: live(w).id });
  });
});

describe("abort", () => {
  const state = (ours: string, outcome?: State["outcome"]): State => ({
    worker: WORKER,
    stable: OLD,
    canary: NEW,
    ours,
    outcome,
  });

  it("puts the old version back when the split is still this run's", async () => {
    const w = world({
      deployments: [
        { id: "d0", versions: OLD_100 },
        { id: "d1", versions: at(10) },
      ],
    });
    expect(await abort(state("d1"), envFor(w))).toMatch(/Rolled back/);
    expect(w.posted).toEqual([OLD_100]);
  });

  it("retries the rollback of a run that failed half-way", async () => {
    const w = world({
      deployments: [
        { id: "d0", versions: OLD_100 },
        { id: "d1", versions: at(10) },
      ],
    });
    const st = state("d1", "failed");
    expect(await abort(st, envFor(w))).toMatch(/Rolled back/);
    expect(w.posted).toEqual([OLD_100]);
    expect(st).toMatchObject({ outcome: "rolled-back-cancelled", ours: "d2" });
  });

  it("does nothing after a finished run or someone else's deploy", async () => {
    const w = world({
      deployments: [
        { id: "d0", versions: OLD_100 },
        { id: "d1", versions: at(10) },
      ],
    });
    expect(await abort(state("d1", "promoted"), envFor(w))).toMatch(/Nothing to do/);
    expect(await abort(state("d9"), envFor(w))).toMatch(/Left alone/);
    expect(w.posted).toEqual([]);
  });
});
