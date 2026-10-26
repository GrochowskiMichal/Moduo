#!/usr/bin/env bun
// Canary rollout for the app Worker (specs/harness-v3.md, HV-28, AC23). The deploy uploads a
// version with `wrangler versions upload` and hands it here; this moves traffic with Cloudflare's
// gradual deployments and rolls back by version on its own:
//
//   1. smoke   the new version at 0%: the full hosting smoke test (scripts/smoke-hosting.ts),
//              sent to it with the Cloudflare-Workers-Version-Overrides header. No user sees it.
//   2. canary  the new version at 10%. Version affinity (a zone Transform Rule that sets
//              Cloudflare-Workers-Version-Key from the client IP, docs/release.md §4) keeps each
//              visitor on one version, so a page from one build never asks the other for its
//              chunks. Without it a split breaks pages; the run then skips the soak and promotes
//              as a plain deploy would (--without-affinity promote, the default), or soaks anyway
//              (soak, the staging rehearsal).
//   3. soak    15 minutes. Every 30 s a probe round hits the new version (the shell, a deep link,
//              /config.json naming the build); every minute the Workers analytics compare its
//              error rate with the old version's. Two failed probe rounds in a row, or an error
//              rate over max(2%, 2× the old version's) on at least 20 requests, is a spike.
//   4. verdict no spike: the new version at 100%. Spike: the old version at 100% (rollback).
//
// Every change after the first checks that the Worker still runs the deployment this run made:
// if anyone else deployed meanwhile, the run changes nothing and exits 3. A cancelled run
// (SIGINT/SIGTERM, or `abort` from the workflow's cleanup step) restores the old version.
//
//   bun scripts/release/canary.ts run --worker <name> --version <id> --url <origin> --build <sha7>
//       [--percent 10] [--minutes 15] [--interval 30] [--state <file>] [--expect key=value]…
//       [--old <file>] [--without-affinity promote|soak] [--expect-rollback]
//   bun scripts/release/canary.ts abort --state <file>
//
// Needs CLOUDFLARE_API_TOKEN (Workers Scripts: Edit; Account Analytics: Read for the analytics
// half, else the probes decide alone) and CLOUDFLARE_ACCOUNT_ID. Prints a Markdown report on
// stdout. Exit 0: promoted (with --expect-rollback: rolled back during the soak). 1: rolled back
// or failed (also before any change). 2: usage. 3: someone else changed the deployment; left alone.
import { readFileSync, writeFileSync } from "node:fs";

import { type Check, smoke } from "../smoke-hosting";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type Split = { version_id: string; percentage: number }[];
export type Deployment = { id: string; versions: Split };

export type Thresholds = {
  /** Consecutive failed probe rounds that count as a spike. */
  probeRounds: number;
  /** The canary's error rate must exceed this and `stableFactor` × the old version's. */
  minRate: number;
  stableFactor: number;
  /** Fewer canary requests than this say nothing. */
  minRequests: number;
};

export const THRESHOLDS: Thresholds = {
  probeRounds: 2,
  minRate: 0.02,
  stableFactor: 2,
  minRequests: 20,
};

export type Counts = { requests: number; errors: number };

/** One version's requests and errors since the canary started (Workers analytics). */
export type Analytics = { canary: Counts; stable: Counts } | null;

/** Whether the soak has seen a spike, and why. Pure, for tests. */
export function judge(
  failedRoundsInARow: number,
  analytics: Analytics,
  t: Thresholds = THRESHOLDS,
): { spike: boolean; reason: string } {
  if (failedRoundsInARow >= t.probeRounds)
    return { spike: true, reason: `${failedRoundsInARow} probe rounds in a row failed` };
  if (analytics && analytics.canary.requests >= t.minRequests) {
    const rate = analytics.canary.errors / analytics.canary.requests;
    const base = analytics.stable.requests
      ? analytics.stable.errors / analytics.stable.requests
      : 0;
    const limit = Math.max(t.minRate, t.stableFactor * base);
    if (rate > limit)
      return {
        spike: true,
        reason: `error rate ${pct(rate)} over ${analytics.canary.requests} requests (limit ${pct(limit)}, old version ${pct(base)})`,
      };
  }
  return { spike: false, reason: "" };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** The one version a deployment runs at 100%, or null when it is split. */
export function single(d: Deployment): string | null {
  return d.versions.length === 1 && d.versions[0].percentage === 100
    ? d.versions[0].version_id
    : null;
}

export type CanaryEnv = {
  accountId: string;
  token: string;
  fetchFn?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
};

const API = "https://api.cloudflare.com/client/v4";

/** The Cloudflare calls the canary makes. */
export function cloudflare(env: CanaryEnv, worker: string) {
  const f: Fetch = env.fetchFn ?? fetch;
  const headers = { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" };
  const base = `${API}/accounts/${env.accountId}/workers/scripts/${worker}/deployments`;

  const call = async (url: string, init: RequestInit): Promise<unknown> => {
    const res = await f(url, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { message?: string }[];
      result?: unknown;
    };
    if (!res.ok || body.success === false) {
      const why = (body.errors ?? []).map((e) => e.message).join("; ");
      throw new Error(`Cloudflare ${init.method ?? "GET"} ${url}: ${res.status} ${why}`);
    }
    return body.result;
  };

  return {
    async current(): Promise<Deployment> {
      const r = (await call(base, { method: "GET" })) as { deployments?: Deployment[] };
      const d = r.deployments?.[0];
      if (!d) throw new Error(`${worker} has no deployment`);
      return {
        id: d.id,
        versions: d.versions.map(({ version_id, percentage }) => ({ version_id, percentage })),
      };
    },
    async deploy(versions: Split, message: string, force = false): Promise<Deployment> {
      const d = (await call(force ? `${base}?force=true` : base, {
        method: "POST",
        body: JSON.stringify({
          strategy: "percentage",
          versions,
          annotations: { "workers/message": message },
        }),
      })) as Deployment;
      return { id: d.id, versions };
    },
    /** Requests and errors per version since `since`; null when the token can't read analytics. */
    async analytics(since: Date, canary: string, stable: string): Promise<Analytics> {
      const query = `query($a: String!, $s: String!, $t: Time!) { viewer { accounts(filter: { accountTag: $a }) {
        workersInvocationsAdaptive(limit: 100, filter: { scriptName: $s, datetime_geq: $t }) {
          sum { requests errors } dimensions { scriptVersion } } } } }`;
      try {
        const res = await f(`${API}/graphql`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query,
            variables: { a: env.accountId, s: worker, t: since.toISOString() },
          }),
        });
        const body = (await res.json()) as {
          errors?: unknown[] | null;
          data?: {
            viewer?: {
              accounts?: {
                workersInvocationsAdaptive?: {
                  sum: Counts;
                  dimensions: { scriptVersion?: string };
                }[];
              }[];
            };
          };
        };
        const rows = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
        if (!res.ok || body.errors?.length || !rows) return null;
        const sum = (v: string): Counts =>
          rows
            .filter((r) => r.dimensions.scriptVersion === v)
            .reduce(
              (a, r) => ({
                requests: a.requests + r.sum.requests,
                errors: a.errors + r.sum.errors,
              }),
              { requests: 0, errors: 0 },
            );
        return { canary: sum(canary), stable: sum(stable) };
      } catch {
        return null;
      }
    },
  };
}

export type RunOptions = {
  worker: string;
  version: string;
  url: string;
  build: string;
  percent: number;
  minutes: number;
  intervalSeconds: number;
  expect: Record<string, string>;
  old: string[];
  withoutAffinity: "promote" | "soak";
  statePath?: string;
};

export type Outcome =
  | "promoted"
  | "promoted-without-soak"
  | "rolled-back-smoke"
  | "rolled-back-soak"
  | "refused"
  | "left-alone"
  | "failed";

export type State = {
  worker: string;
  stable: string;
  canary: string;
  /** The deployment this run made last; a change by anyone else differs from it. */
  ours: string;
  outcome?: Outcome;
};

export type RunResult = { outcome: Outcome; report: string[] };

class Moved extends Error {}

/** The version override header that sends one request to `version`. */
export function override(worker: string, version: string): Record<string, string> {
  return { "Cloudflare-Workers-Version-Overrides": `${worker}="${version}"` };
}

/** One probe round against the canary: true when every request answered as the new build. */
export async function probe(
  f: Fetch,
  url: string,
  headers: Record<string, string>,
  build: string,
): Promise<{ ok: boolean; detail: string }> {
  const root = url.replace(/\/+$/, "");
  const problems: string[] = [];
  for (const path of ["/", "/tasks", "/config.json"]) {
    try {
      const res = await f(`${root}${path}`, { headers, redirect: "manual" });
      const text = await res.text();
      if (res.status !== 200) problems.push(`${path} → ${res.status}`);
      else if (path === "/config.json") {
        const got = (JSON.parse(text) as { build?: string }).build;
        if (got !== build) problems.push(`/config.json build ${got}, want ${build}`);
      } else if (!text.includes("__MODUO_CONFIG__")) problems.push(`${path} → not the shell`);
    } catch (e) {
      problems.push(`${path} → ${(e as Error).message}`);
    }
  }
  return { ok: problems.length === 0, detail: problems.join("; ") };
}

/**
 * Whether the platform keeps this client on one version: `samples` requests without an override,
 * all naming the same build. Without affinity, a 10% split shows both within 40 requests 98.5% of
 * the time.
 */
export async function hasAffinity(f: Fetch, url: string, samples = 40): Promise<boolean> {
  const root = url.replace(/\/+$/, "");
  const builds = new Set<string>();
  for (let i = 0; i < samples; i++) {
    try {
      const res = await f(`${root}/config.json`, { redirect: "manual" });
      builds.add(((await res.json()) as { build?: string }).build ?? "");
    } catch {
      builds.add("(error)");
    }
    if (builds.size > 1) return false;
  }
  return true;
}

type Stage = {
  opts: RunOptions;
  f: Fetch;
  cf: ReturnType<typeof cloudflare>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  note: (line: string) => void;
  stable: string;
  headers: Record<string, string>;
};

/** The old version when the Worker serves exactly one other version at 100%, else null (noted). */
async function preflight(s: Omit<Stage, "stable" | "headers">): Promise<Deployment | null> {
  const before = await s.cf.current();
  const stable = single(before);
  if (!stable)
    s.note(
      `Refused: the Worker is split (${describe(before.versions)}). Finish or roll back that rollout first (docs/release.md §4).`,
    );
  else if (stable === s.opts.version)
    s.note(`Refused: ${short(s.opts.version)} already serves 100%.`);
  return stable && stable !== s.opts.version ? before : null;
}

/** The hosting smoke test against the new version alone; the failures, or "" when it passed. */
async function smokeAtZero(s: Stage): Promise<string> {
  const checks: Check[] = await smoke(s.opts.url, {
    old: s.opts.old,
    expect: { ...s.opts.expect, build: s.opts.build },
    fetchFn: (u, init) =>
      s.f(u, {
        redirect: "manual",
        ...init,
        headers: { ...s.headers, ...(init?.headers as object) },
      }),
  });
  const failed = checks.filter((c) => !c.ok);
  if (!failed.length)
    s.note(`Smoke at 0%: ${checks.length} checks passed on ${short(s.opts.version)}.`);
  return failed.map((c) => `${c.name} (${c.detail})`).join("; ");
}

/** Probes and analytics until the soak ends or a spike; the spike's reason, or "" when none. */
async function soak(s: Stage, started: number): Promise<string> {
  const end = started + s.opts.minutes * 60_000;
  let inARow = 0;
  let rounds = 0;
  let failedRounds = 0;
  let lastAnalytics = 0;
  let analytics: Analytics = null;
  while (s.now() < end) {
    const p = await probe(s.f, s.opts.url, s.headers, s.opts.build);
    rounds++;
    inARow = p.ok ? 0 : inARow + 1;
    if (!p.ok) {
      failedRounds++;
      s.log(`probe round ${rounds} failed: ${p.detail}`);
    }
    if (s.now() - lastAnalytics >= 60_000) {
      const first = lastAnalytics === 0;
      lastAnalytics = s.now();
      analytics = await s.cf.analytics(new Date(started), s.opts.version, s.stable);
      if (!analytics && first)
        s.note(
          "Workers analytics unavailable (token needs Account Analytics: Read); probes decide alone.",
        );
    }
    const v = judge(inARow, analytics);
    if (v.spike) {
      s.note(`Spike after ${Math.round((s.now() - started) / 1000)} s: ${v.reason}.`);
      return v.reason;
    }
    await s.sleep(s.opts.intervalSeconds * 1000);
  }
  const seen = analytics
    ? `; analytics: ${analytics.canary.errors}/${analytics.canary.requests} errors on the new version, ${analytics.stable.errors}/${analytics.stable.requests} on the old`
    : "";
  s.note(
    `Soak: ${s.opts.minutes} min, ${rounds} probe rounds (${failedRounds} failed, never ${THRESHOLDS.probeRounds} in a row)${seen}.`,
  );
  return "";
}

export async function run(opts: RunOptions, env: CanaryEnv): Promise<RunResult> {
  const report: string[] = [`**Canary · ${opts.worker} · ${opts.build}**`, ""];
  const log = env.log ?? ((line: string) => console.error(line));
  const base = {
    opts,
    f: env.fetchFn ?? fetch,
    cf: cloudflare(env, opts.worker),
    now: env.now ?? Date.now,
    sleep: env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    log,
    note: (line: string) => {
      report.push(`- ${line}`);
      log(line);
    },
  };
  const before = await preflight(base);
  if (!before) return { outcome: "refused", report };
  const stable = before.versions[0].version_id;
  const s: Stage = { ...base, stable, headers: override(opts.worker, opts.version) };
  const { note, cf } = s;

  const state: State = { worker: opts.worker, stable, canary: opts.version, ours: before.id };
  const save = () => {
    if (opts.statePath) writeFileSync(opts.statePath, JSON.stringify(state));
  };

  // Every change after the first: only on top of the deployment this run made.
  const move = async (versions: Split, message: string, force = false) => {
    const live = await cf.current();
    if (live.id !== state.ours)
      throw new Moved(`deployment ${live.id} (${describe(live.versions)})`);
    const d = await cf.deploy(versions, message, force);
    state.ours = d.id;
    save();
  };
  const at = (p: number): Split =>
    p >= 100
      ? [{ version_id: opts.version, percentage: 100 }]
      : [
          { version_id: opts.version, percentage: p },
          { version_id: stable, percentage: 100 - p },
        ];
  const rollback = async (why: string, outcome: Outcome): Promise<RunResult> => {
    await move(
      [{ version_id: stable, percentage: 100 }],
      `rollback ${opts.build}: ${why}`.slice(0, 100),
      true,
    );
    note(`Rolled back to ${short(stable)}.`);
    return finish(outcome);
  };
  const finish = (outcome: Outcome): RunResult => {
    state.outcome = outcome;
    save();
    return { outcome, report };
  };

  save();
  try {
    // 1. Smoke at 0%.
    await move(at(0), `canary ${opts.build} 0%`);
    const smokeFailed = await smokeAtZero(s);
    if (smokeFailed) {
      note(`Smoke at 0% failed: ${smokeFailed}`);
      return await rollback("smoke failed", "rolled-back-smoke");
    }

    // 2. The canary slice.
    await move(at(opts.percent), `canary ${opts.build} ${opts.percent}%`);
    const started = s.now();
    note(
      `${opts.percent}% of traffic on ${short(opts.version)}, ${100 - opts.percent}% on ${short(stable)}.`,
    );
    if (!(await hasAffinity(s.f, opts.url))) {
      if (opts.withoutAffinity === "promote") {
        await move(at(100), `canary ${opts.build} 100% (no affinity)`);
        note(
          "⚠️ No version affinity on this host: a split would serve pages and chunks from different builds. Promoted to 100% without the soak. Add the Transform Rule (docs/release.md §4).",
        );
        return finish("promoted-without-soak");
      }
      note("⚠️ No version affinity on this host; soaking anyway.");
    }

    // 3. Soak.
    const spike = await soak(s, started);
    if (spike) return await rollback(spike, "rolled-back-soak");

    // 4. Promote.
    await move(at(100), `canary ${opts.build} 100%`);
    note(`Promoted ${short(opts.version)} to 100%.`);
    return finish("promoted");
  } catch (e) {
    if (e instanceof Moved) {
      note(`Someone else deployed meanwhile (${e.message}); this run changed nothing more.`);
      return finish("left-alone");
    }
    note(`Failed: ${(e as Error).message}`);
    try {
      await rollback("canary error", "failed");
    } catch (r) {
      note(`Rollback failed too: ${(r as Error).message}. Roll back by hand (docs/release.md §4).`);
    }
    return finish("failed");
  }
}

/** Restores the old version when the deployment is still the one a cancelled run made. */
export async function abort(state: State, env: CanaryEnv): Promise<string> {
  if (state.outcome) return `Nothing to do: the run finished (${state.outcome}).`;
  const cf = cloudflare(env, state.worker);
  const live = await cf.current();
  if (live.id !== state.ours)
    return `Left alone: the Worker runs ${describe(live.versions)}, not this run's deployment.`;
  if (single(live) === state.stable) return `Nothing to do: ${short(state.stable)} serves 100%.`;
  await cf.deploy(
    [{ version_id: state.stable, percentage: 100 }],
    "rollback: canary cancelled",
    true,
  );
  return `Rolled back to ${short(state.stable)} (the canary run was cancelled).`;
}

function short(id: string): string {
  return id.slice(0, 8);
}

function describe(split: Split): string {
  return split.map((v) => `${short(v.version_id)}@${v.percentage}%`).join(", ");
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const all = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
  const env: CanaryEnv = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  };
  const usage = () => {
    console.error(
      "usage: bun scripts/release/canary.ts run --worker <name> --version <id> --url <origin> --build <sha7> [--percent 10] [--minutes 15] [--interval 30] [--state <file>] [--expect k=v]… [--old <file>] [--without-affinity promote|soak] [--expect-rollback]\n       bun scripts/release/canary.ts abort --state <file>",
    );
    process.exit(2);
  };
  if (!env.accountId || !env.token) {
    console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set.");
    process.exit(2);
  }

  if (cmd === "abort") {
    const path = flag("--state");
    if (!path) usage();
    let state: State;
    try {
      state = JSON.parse(readFileSync(path as string, "utf8")) as State;
    } catch {
      console.log("Nothing to do: no canary state (the run never started a rollout).");
      process.exit(0);
    }
    console.log(await abort(state, env));
    process.exit(0);
  }

  if (cmd !== "run") usage();
  const worker = flag("--worker");
  const version = flag("--version");
  const url = flag("--url");
  const build = flag("--build");
  const withoutAffinity = flag("--without-affinity") ?? "promote";
  if (!worker || !version || !url || !build) usage();
  if (withoutAffinity !== "promote" && withoutAffinity !== "soak") usage();
  const oldFile = flag("--old");
  const opts: RunOptions = {
    worker: worker as string,
    version: version as string,
    url: url as string,
    build: build as string,
    percent: Number(flag("--percent") ?? 10),
    minutes: Number(flag("--minutes") ?? 15),
    intervalSeconds: Number(flag("--interval") ?? 30),
    expect: Object.fromEntries(
      all("--expect").map((kv) => {
        const [k, ...v] = kv.split("=");
        return [k, v.join("=")];
      }),
    ),
    old: oldFile
      ? readFileSync(oldFile, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : [],
    withoutAffinity: withoutAffinity as "promote" | "soak",
    statePath: flag("--state"),
  };
  if (
    !(opts.percent > 0 && opts.percent < 100) ||
    !(opts.minutes > 0) ||
    !(opts.intervalSeconds > 0)
  )
    usage();
  const expectRollback = args.includes("--expect-rollback");

  // A cancelled job gets SIGINT, then SIGTERM: put the old version back before exiting.
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      if (opts.statePath) {
        try {
          const state = JSON.parse(readFileSync(opts.statePath, "utf8")) as State;
          console.error(await abort(state, env));
        } catch (e) {
          console.error(`abort failed: ${(e as Error).message}`);
        }
      }
      process.exit(1);
    });
  }

  const result = await run(opts, env).catch((e: Error) => {
    // Before the first change (reading the deployment): nothing to undo.
    console.error(e.message);
    process.exit(1);
  });
  console.log(result.report.join("\n"));
  if (expectRollback) process.exit(result.outcome === "rolled-back-soak" ? 0 : 1);
  process.exit(
    result.outcome === "promoted" || result.outcome === "promoted-without-soak"
      ? 0
      : result.outcome === "left-alone"
        ? 3
        : 1,
  );
}
