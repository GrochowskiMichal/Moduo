/**
 * Pure half of the deployed-Edge-Function ↔ `supabase/functions/` reconciliation
 * (`bun run functions:reconcile`; the CLI shell is `scripts/functions-reconcile.ts`).
 *
 * Lives under src/ for the same reason as db-reconcile-core.ts: nothing under scripts/ is in
 * tsconfig or in rstest's include list, so this is the half `bun run verify` typechecks and
 * tests — see functions-reconcile-core.test.ts.
 *
 * WHY THIS EXISTS: deleting `supabase/functions/<name>/` does not undeploy the function.
 * `founders-apply` stayed deployed, public and answering after its folder left the repo,
 * until it was deleted by hand on 2026-10-07 (docs/decisions/billing.md). Nothing compared
 * what is deployed with what the repo holds; this does.
 *
 * LIMITS: it compares names, never code, so a function deployed from stale source reads as
 * in sync. And the repo side is the branch it runs on: a function that only a newer branch
 * has reads as an orphan there.
 */

/** The production Supabase project. */
export const PROD_PROJECT_REF = "wtoonrvuqumihpkbvwvs";

/**
 * Deployed functions that are not built from this repo, each mapped to who installed it.
 * They are never orphans, but two things about them still fail the check:
 * - a repo folder with the same name (a collision). Deploying it replaces the integration's
 *   function, which the billing decision of 2026-10-06 forbids for our old `stripe-webhook`.
 * - a deployed copy whose entrypoint isn't the integration's own `…/source/index.ts`, so
 *   something else was deployed over it. `supabase functions deploy` from a checkout gives
 *   `…/source/supabase/functions/<slug>/index.ts` (what deploying from `origin/main`, which
 *   still has `stripe-webhook/`, would do); the MCP connector can give
 *   `…/source/<slug>/index.ts`. A replacement deployed with `index.ts` at the bundle root
 *   looks exactly like the integration's own and is NOT detected.
 * A Map, not an object literal, so a slug like `constructor` can't match an inherited key.
 */
export const KNOWN_EXTERNAL_FUNCTIONS: ReadonlyMap<string, string> = new Map([
  ["stripe-setup", "the Stripe Sync Engine integration"],
  ["stripe-webhook", "the Stripe Sync Engine integration"],
  ["stripe-worker", "the Stripe Sync Engine integration"],
]);

/** One deployed function, as far as this check needs it. */
export type DeployedFunction = {
  slug: string;
  /** `ACTIVE`, `REMOVED` or `THROTTLED` per the Management API. Shown, never compared. */
  status: string;
  version: number | null;
  /** Epoch milliseconds. */
  updatedAt: number | null;
  /** Where the bundle's entrypoint sat when it was built, e.g. `file:///tmp/…/source/index.ts`. */
  entrypointPath: string | null;
};

export type ExternalFunction = {
  slug: string;
  installer: string;
  deployed: DeployedFunction | null;
  /**
   * The deployed copy's entrypoint isn't the integration's own `…/source/index.ts`, so
   * something else, most likely repo code, was deployed over it. Fails the check.
   */
  replaced: boolean;
};

export type FunctionsDrift = {
  /** Deployed, not in the repo, not on the allowlist. Fails the check. */
  orphans: DeployedFunction[];
  /**
   * A repo function with nothing deployed. Reported, never failed: a new function is in this
   * state until its first deploy.
   */
  notDeployed: string[];
  /** Every allowlisted slug, with its deployed copy when there is one. */
  external: ExternalFunction[];
  /** A repo folder named like an allowlisted slug. Fails the check. */
  collisions: string[];
  /** Deployed and in the repo. Names only: the deployed code is never compared. */
  inSync: DeployedFunction[];
};

const FUNCTIONS_DIR = "supabase/functions/";

/** A deployable slug: the Supabase CLI's `FuncSlugPattern`, so `_shared` never counts. */
const SLUG = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The CLI's default entrypoint. This repo has no config.toml that names another one. */
const ENTRYPOINT = "index.ts";

/** How the integration's own deploys end, e.g. `file:///tmp/user_fn_<ref>_<id>/source/index.ts`. */
const INTEGRATION_ENTRYPOINT = "/source/index.ts";

/**
 * `git` arguments that list what the branch has committed under supabase/functions/, run from
 * the repo root. The script and the repo guard test both use them, so they read the same input.
 */
export const COMMITTED_FUNCTIONS_GIT_ARGS: readonly string[] = [
  "ls-tree",
  "-r",
  "-z",
  "--name-only",
  "HEAD",
  "--",
  "supabase/functions",
];

/**
 * Validate the list `GET /v1/projects/{ref}/functions` returns (and
 * `supabase functions list -o json`, which prints the same payload). Throws on any other
 * shape: a parse that quietly returned [] would report zero orphans and pass the check.
 */
export function parseDeployedFunctions(raw: unknown): DeployedFunction[] {
  if (!Array.isArray(raw)) {
    throw new Error(`expected a JSON array of functions, got ${preview(raw)}`);
  }
  return raw.map((item, i) => {
    if (!isRecord(item) || typeof item.slug !== "string" || item.slug === "") {
      throw new Error(`function #${i} has no slug: ${preview(item)}`);
    }
    return {
      slug: item.slug,
      status: typeof item.status === "string" ? item.status : "UNKNOWN",
      version: typeof item.version === "number" ? item.version : null,
      updatedAt: typeof item.updated_at === "number" ? item.updated_at : null,
      entrypointPath: typeof item.entrypoint_path === "string" ? item.entrypoint_path : null,
    };
  });
}

/**
 * The repo's functions, from the NUL-separated paths that `git ls-tree -r -z --name-only HEAD --
 * supabase/functions` (COMMITTED_FUNCTIONS_GIT_ARGS) prints. The branch's last commit, not the disk or the index: a folder nobody has committed
 * is not in the repo yet, so it must not hide an orphan. A function is a folder directly under
 * supabase/functions/ with a slug name and an index.ts, which is what the CLI deploys;
 * `_shared/` and files such as `deno.json` are not. `skipped` names any other folder there
 * that doesn't start with `_` or `.`.
 */
export function repoFunctionsFromPaths(paths: readonly string[]): {
  functions: string[];
  skipped: string[];
} {
  const folders = new Set<string>();
  const withEntrypoint = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(FUNCTIONS_DIR)) continue;
    const [folder, ...rest] = path.slice(FUNCTIONS_DIR.length).split("/");
    if (rest.length === 0) continue; // a file such as deno.json, not a folder
    folders.add(folder);
    if (rest.length === 1 && rest[0] === ENTRYPOINT) withEntrypoint.add(folder);
  }
  const functions: string[] = [];
  const skipped: string[] = [];
  for (const name of folders) {
    if (SLUG.test(name) && withEntrypoint.has(name)) functions.push(name);
    else if (!name.startsWith("_") && !name.startsWith(".")) skipped.push(name);
  }
  return { functions: functions.sort(compareText), skipped: skipped.sort(compareText) };
}

/**
 * Why a deployed list can't be believed, or null. Nothing deployed while the repo has
 * functions means the wrong project or a broken source, not a clean prod, so the CLI exits 2
 * instead of printing OK.
 */
export function untrustworthyList(
  deployed: readonly DeployedFunction[],
  repo: readonly string[],
): string | null {
  return deployed.length === 0 && repo.length > 0
    ? `the deployed list is empty but the repo has ${repo.length} functions, which points at the wrong project or a broken list, not a clean one`
    : null;
}

export function compareFunctions(
  deployed: readonly DeployedFunction[],
  repo: readonly string[],
  external: ReadonlyMap<string, string> = KNOWN_EXTERNAL_FUNCTIONS,
): FunctionsDrift {
  const repoSet = new Set(repo);
  const bySlug = new Map(deployed.map((f) => [f.slug, f]));
  const sorted = [...bySlug.values()].sort((a, b) => compareText(a.slug, b.slug));
  const ours = [...repoSet].filter((slug) => !external.has(slug)).sort(compareText);
  return {
    orphans: sorted.filter((f) => !repoSet.has(f.slug) && !external.has(f.slug)),
    notDeployed: ours.filter((slug) => !bySlug.has(slug)),
    external: [...external]
      .map(([slug, installer]) => {
        const copy = bySlug.get(slug) ?? null;
        const entrypoint = copy?.entrypointPath ?? null;
        // No entrypoint means it can't be told either way; formatReport says so.
        const replaced = entrypoint !== null && !entrypoint.endsWith(INTEGRATION_ENTRYPOINT);
        return { slug, installer, deployed: copy, replaced };
      })
      .sort((a, b) => compareText(a.slug, b.slug)),
    collisions: [...repoSet].filter((slug) => external.has(slug)).sort(compareText),
    inSync: sorted.filter((f) => repoSet.has(f.slug) && !external.has(f.slug)),
  };
}

/** Orphans, collisions and replaced integration functions fail; the rest is information. */
export function failsCheck(drift: FunctionsDrift): boolean {
  return (
    drift.orphans.length > 0 ||
    drift.collisions.length > 0 ||
    drift.external.some((e) => e.replaced)
  );
}

/**
 * Whether a token can go into an HTTP header as it is: visible ASCII only. Anything else is a
 * bad paste (smart quotes, a newline, two tokens), and fetch rejects such a header with an
 * error message that quotes it in full.
 */
export function isHeaderSafe(token: string): boolean {
  return /^[\x21-\x7e]+$/.test(token);
}

/** Replace every occurrence of a secret in text that is about to be printed. */
export function redact(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("<redacted>");
}

/** The human-readable report the CLI prints. Pure, so tests can pin it. */
export function formatReport(
  drift: FunctionsDrift,
  opts: { projectRef: string; source: string; skipped?: readonly string[] },
): string {
  const out: string[] = [
    `Edge Functions on ${opts.projectRef} (via ${opts.source}) vs supabase/functions/`,
    "",
  ];
  const group = (title: string, rows: string[]) => {
    out.push(rows.length === 0 ? `${title}: none` : `${title} (${rows.length}):`);
    for (const row of rows) out.push(`  ${row}`);
  };
  const externalRows = drift.external.map((e) => ({
    slug: e.slug,
    state: e.deployed
      ? `${describeDeployed(e.deployed)}${e.replaced ? ", NOT THE INTEGRATION'S BUILD" : ""}`
      : "not deployed",
    installer: e.installer,
  }));
  const slugWidth = Math.max(0, ...[...drift.orphans, ...drift.external].map((f) => f.slug.length));
  const stateWidth = Math.max(0, ...externalRows.map((row) => row.state.length));

  group(
    "Deployed but not in the repo (orphans)",
    drift.orphans.map((f) => `${f.slug.padEnd(slugWidth)}  ${describeDeployed(f)}`),
  );
  group("In the repo but not deployed", drift.notDeployed);
  group(
    "Known external, not built from this repo",
    externalRows.map(
      (row) =>
        `${row.slug.padEnd(slugWidth)}  ${row.state.padEnd(stateWidth)}  installed by ${row.installer}`,
    ),
  );

  const inactive = drift.inSync.filter((f) => f.status !== "ACTIVE");
  out.push(
    `Deployed and in the repo: ${drift.inSync.length} (names only; the deployed code is not compared)` +
      (inactive.length > 0
        ? `. Not ACTIVE: ${inactive.map((f) => `${f.slug} (${f.status})`).join(", ")}`
        : ""),
  );
  for (const e of drift.external.filter((x) => x.deployed && x.deployed.entrypointPath === null)) {
    out.push(
      `Can't tell whether ${e.slug} is still the build ${e.installer} deployed: prod reports no entrypoint for it.`,
    );
  }
  if (opts.skipped && opts.skipped.length > 0) {
    out.push(
      `Not counted as functions (a function needs a slug name and an ${ENTRYPOINT}): ${opts.skipped.join(", ")}`,
    );
  }
  out.push("");

  if (drift.orphans.length > 0) {
    const n = drift.orphans.length;
    out.push(
      `FAIL: ${n} deployed function${n === 1 ? " is" : "s are"} not on the allowlist and not in this branch's supabase/functions/<slug>/${ENTRYPOINT}.`,
      "  A deployed function keeps answering, with the project's secrets, until someone deletes it.",
      "  1. Look for it on other branches, after a git fetch:",
      "     git log --all --oneline -- supabase/functions/<slug>/",
      "  2. Ours and still needed: commit or restore its folder.",
      "  3. Installed by an integration: add it to KNOWN_EXTERNAL_FUNCTIONS in",
      "     src/lib/functions-reconcile-core.ts, saying who installed it.",
      "  4. Dead (check its callers and logs, and agree it with the designer):",
      `     supabase functions delete <slug> --project-ref ${opts.projectRef}`,
      "     then log the undeploy in docs/decisions.md.",
    );
  }
  for (const slug of drift.collisions) {
    const installer = drift.external.find((e) => e.slug === slug)?.installer ?? "an integration";
    out.push(
      `FAIL: supabase/functions/${slug}/ uses the slug of a function installed by ${installer}.`,
      "  Deploying that folder would replace the integration's function. Rename or remove the folder.",
    );
  }
  for (const e of drift.external.filter((x) => x.replaced)) {
    out.push(
      `FAIL: the deployed ${e.slug} does not have the …/source/index.ts entrypoint of ${e.installer}'s own deploys, so something else (most likely repo code) was deployed over it.`,
      `  Its entrypoint: ${e.deployed?.entrypointPath}`,
      `  Check its code in the dashboard, reinstall it from the integration, and delete any supabase/functions/${e.slug}/ folder a branch still has.`,
    );
  }
  if (!failsCheck(drift)) {
    out.push("OK: every deployed function is in the repo or on the allowlist.");
  }
  out.push("This check only reads. It never deploys or deletes anything.");
  return out.join("\n");
}

function describeDeployed(f: DeployedFunction): string {
  const version = f.version === null ? "" : ` v${f.version}`;
  const day = f.updatedAt === null ? null : new Date(f.updatedAt);
  const date =
    day && !Number.isNaN(day.getTime()) ? `, deployed ${day.toISOString().slice(0, 10)}` : "";
  return `${f.status}${version}${date}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function preview(v: unknown): string {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
