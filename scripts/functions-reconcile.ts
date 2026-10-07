/**
 * Deployed Edge Functions ↔ `supabase/functions/` reconciliation (CLI shell).
 *
 * `bun run functions:reconcile` lists the functions deployed on the prod project and
 * compares them with the function folders committed on this branch under supabase/functions/
 * (`_shared/` and `deno.json` are not functions). It reports three groups: deployed but not
 * in the repo (orphans), in the repo but not deployed, and the known external slugs (the
 * Stripe Sync Engine's). READ-ONLY: it never deploys or deletes anything, and every message
 * it prints has the token redacted.
 *
 * Where the deployed list comes from, first match wins:
 *   1. `--fixture <file.json>`: a saved list, for a dry run that never calls Supabase.
 *   2. SUPABASE_ACCESS_TOKEN set: GET https://api.supabase.com/v1/projects/{ref}/functions
 *      (the CI path; the token only goes into the Authorization header).
 *   3. Otherwise `supabase functions list --project-ref <ref> -o json`, on the CLI's own
 *      login (`supabase login`).
 *
 * Exit codes: 0 clean · 1 drift (an orphan, a repo folder named like an integration's
 * function, or an integration's function replaced by another build) · 2 could not check (no
 * credentials, API or CLI error, unexpected output, an empty list). "In the repo but not
 * deployed" never fails: a new function is in that state until its first deploy.
 *
 * Run it on an up-to-date branch: a function that only a newer branch has reads as an orphan.
 * It compares names, not code (see LIMITS in the core file).
 *
 * All comparison logic lives in `src/lib/functions-reconcile-core.ts` so that
 * `bun run verify` typechecks and tests it (nothing under scripts/ is in tsconfig). The
 * database-side sibling is `bun run db:reconcile` (scripts/db-reconcile.ts).
 *
 * Usage: bun run functions:reconcile [--project-ref <ref>] [--fixture <file.json>]
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  COMMITTED_FUNCTIONS_GIT_ARGS,
  compareFunctions,
  type DeployedFunction,
  failsCheck,
  formatReport,
  isHeaderSafe,
  PROD_PROJECT_REF,
  parseDeployedFunctions,
  redact,
  repoFunctionsFromPaths,
  untrustworthyList,
} from "../src/lib/functions-reconcile-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.supabase.com/v1";
const USAGE = "Usage: bun run functions:reconcile [--project-ref <ref>] [--fixture <file.json>]";

// Read once. It only ever goes into the Authorization header, and cannotCheck() redacts it
// from every message, including errors that quote the header back.
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";

function cannotCheck(message: string): never {
  console.error(`functions:reconcile could not check: ${redact(message, token)}`);
  process.exit(2);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fromManagementApi(projectRef: string): Promise<unknown> {
  if (!isHeaderSafe(token)) {
    cannotCheck(
      "SUPABASE_ACCESS_TOKEN contains spaces, line breaks or non-ASCII characters (a bad paste?), so it was not sent.",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${API}/projects/${projectRef}/functions`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    cannotCheck(`the Management API request failed: ${errorText(error)}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).trim().slice(0, 200);
    const hint =
      res.status === 401 || res.status === 403
        ? " (SUPABASE_ACCESS_TOKEN must be a personal access token, sbp_…, for an account that can see this project)"
        : "";
    cannotCheck(`the Management API answered HTTP ${res.status}${hint}${body ? `: ${body}` : ""}`);
  }
  try {
    return await res.json();
  } catch (error) {
    cannotCheck(`the Management API answered with something other than JSON: ${errorText(error)}`);
  }
}

function fromCli(projectRef: string): unknown {
  const run = spawnSync(
    "supabase",
    ["functions", "list", "--project-ref", projectRef, "-o", "json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      // Without this the CLI's update check rewrites the tracked supabase/.temp/cli-latest.
      env: { ...process.env, SUPABASE_NO_UPDATE_NOTIFIER: "1" },
    },
  );
  if (run.error) {
    cannotCheck(
      (run.error as NodeJS.ErrnoException).code === "ENOENT"
        ? "SUPABASE_ACCESS_TOKEN is not set and the supabase CLI is not on PATH. Set the token, or install the CLI and run `supabase login`."
        : `could not run the supabase CLI: ${run.error.message}`,
    );
  }
  if (run.status !== 0) {
    const stderr = run.stderr.trim().split("\n").slice(-5).join("\n");
    cannotCheck(`\`supabase functions list\` exited with ${run.status}:\n${stderr}`);
  }
  try {
    return JSON.parse(run.stdout);
  } catch {
    cannotCheck(
      `\`supabase functions list\` printed something other than JSON: ${run.stdout.slice(0, 200)}`,
    );
  }
}

async function loadDeployed(
  projectRef: string,
  fixture: string | undefined,
): Promise<{ raw: unknown; source: string }> {
  if (fixture) {
    try {
      return { raw: JSON.parse(readFileSync(fixture, "utf8")), source: `fixture ${fixture}` };
    } catch (error) {
      cannotCheck(`could not read the fixture: ${errorText(error)}`);
    }
  }
  if (token) return { raw: await fromManagementApi(projectRef), source: "the Management API" };
  return { raw: fromCli(projectRef), source: "the supabase CLI" };
}

/** What this branch has committed under supabase/functions/, so an uncommitted folder can't hide an orphan. */
function committedFunctionPaths(): string[] {
  const git = spawnSync("git", [...COMMITTED_FUNCTIONS_GIT_ARGS], { cwd: ROOT, encoding: "utf8" });
  if (git.error || git.status !== 0) {
    cannotCheck(`\`git ls-tree\` failed: ${git.error?.message ?? git.stderr.trim()}`);
  }
  return git.stdout.split("\0").filter(Boolean);
}

async function main(): Promise<void> {
  let args: { "project-ref"?: string; fixture?: string };
  try {
    ({ values: args } = parseArgs({
      options: { "project-ref": { type: "string" }, fixture: { type: "string" } },
    }));
  } catch (error) {
    cannotCheck(`${errorText(error)}\n${USAGE}`);
  }
  const projectRef = args["project-ref"] ?? PROD_PROJECT_REF;
  // It goes into a URL path and a CLI argument, so accept only the real ref shape.
  if (!/^[a-z]{20}$/.test(projectRef)) {
    cannotCheck(`"${projectRef}" is not a Supabase project ref (20 lowercase letters)`);
  }

  // The local read first: if git can't answer, don't spend a call to prod.
  const { functions: repo, skipped } = repoFunctionsFromPaths(committedFunctionPaths());

  const { raw, source } = await loadDeployed(projectRef, args.fixture);
  let deployed: DeployedFunction[];
  try {
    deployed = parseDeployedFunctions(raw);
  } catch (error) {
    cannotCheck(`unexpected function list from ${source}: ${errorText(error)}`);
  }

  const problem = untrustworthyList(deployed, repo);
  if (problem) cannotCheck(`${problem} (via ${source})`);

  const drift = compareFunctions(deployed, repo);
  console.log(formatReport(drift, { projectRef, source, skipped }));
  process.exit(failsCheck(drift) ? 1 : 0);
}

// Anything unexpected exits 2 ("could not check"), never 1, which means drift.
main().catch((error) => cannotCheck(`unexpected error: ${errorText(error)}`));
