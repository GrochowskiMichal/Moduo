/**
 * Catching tests for Tier 2 PRs into develop (HV-27, specs/harness-v3.md AC22).
 *
 * ai-review.yml has Claude propose up to five rstest files that pin a behaviour the parent
 * commit has and the PR changes. Claude can't run anything; this script, in a job with no
 * secrets, runs each proposal on the parent and on the PR head and keeps the catches: tests
 * that pass on the parent and fail on the head. Each catch becomes one Markdown comment body,
 * which a separate job posts with `gh pr comment` (it runs no repo code).
 *
 *   bun scripts/ci/catching-tests.ts --tests <proposals.json> --parent <dir> --head <dir>
 *     --out <dir> [--parent-sha <sha>] [--head-sha <sha>]
 *
 * Writes <out>/comments/<n>.md per catch and <out>/summary.md (every proposal and its outcome),
 * and prints `caught=<n>`. The proposals JSON is Claude's structured output:
 * `{ tests: [{ path, behavior, code }], note }`.
 * Written in erasable TypeScript only, so `node` (type stripping) and `bun` both run it.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_TESTS = 5;
const MAX_CODE = 20_000;
const MAX_BEHAVIOR = 1_500;
const MAX_MESSAGE = 1_200;
const RUN_TIMEOUT_MS = 240_000;

export interface Proposal {
  path: string;
  behavior: string;
  code: string;
}

export interface Suite {
  name: "app" | "backend" | "scripts";
  /** Directory rstest runs from, relative to the repo root. */
  cwd: string;
  /** Extra rstest arguments before the file filter. */
  args: string[];
}

/** Where a proposed test file runs, from its path; null if no suite can collect it. */
export function suiteFor(file: string): Suite | null {
  if (file.startsWith("apps/app/")) return { name: "app", cwd: "apps/app", args: [] };
  if (file.startsWith("supabase/")) return { name: "backend", cwd: "supabase", args: [] };
  if (file.startsWith("scripts/")) {
    return { name: "scripts", cwd: ".", args: ["-c", "scripts/rstest.config.ts"] };
  }
  return null;
}

/** Why a proposal can't run, or null when it can. `exists` says whether a path is taken. */
export function rejectReason(
  p: Proposal,
  exists: (file: string) => boolean,
  seen: ReadonlySet<string>,
): string | null {
  if (typeof p?.path !== "string" || typeof p.code !== "string" || typeof p.behavior !== "string")
    return "malformed proposal";
  if (!/^[A-Za-z0-9_./-]+$/.test(p.path) || p.path.split("/").some((s) => s === "" || s === ".."))
    return "path is not a plain relative path";
  if (!/\.catching\.test\.tsx?$/.test(p.path)) return "name must end in .catching.test.ts(x)";
  if (!suiteFor(p.path)) return "path is under no test suite";
  if (seen.has(p.path)) return "duplicate path";
  if (exists(p.path)) return "path already exists";
  if (p.code.length > MAX_CODE) return "test is too long";
  return null;
}

export type RunStatus = "pass" | "fail" | "not-collected" | "error" | "skipped";

export interface RunResult {
  status: RunStatus;
  /** The first failure or error message, trimmed. */
  message: string;
}

interface RstestJson {
  summary?: { testFiles?: number; tests?: number; failedTests?: number; passedTests?: number };
  files?: { errors?: { message?: string }[] }[];
  tests?: { status?: string; fullName?: string; errors?: { message?: string }[] }[];
}

/** The JSON report, which starts at the first line that is exactly `{` (a preamble may hold braces). */
function readReport(stdout: string): RstestJson | null {
  const start = stdout.startsWith("{") ? 0 : stdout.indexOf("\n{\n") + 1;
  if (start === 0 && !stdout.startsWith("{")) return null;
  try {
    return JSON.parse(stdout.slice(start)) as RstestJson;
  } catch {
    return null;
  }
}

/** One rstest run's outcome from its exit code and `--reporter json` output. */
export function parseRun(exitCode: number | null, stdout: string, timedOut = false): RunResult {
  if (timedOut) return { status: "error", message: "timed out" };
  const report = readReport(stdout);
  if (!report) return { status: "error", message: `no rstest report (exit ${exitCode})` };
  const summary = report.summary ?? {};
  if (!summary.testFiles) return { status: "not-collected", message: "no suite collected it" };
  // At least one test must really pass: a file of skipped tests proves nothing on the parent.
  if (exitCode === 0 && (summary.passedTests ?? 0) > 0 && !summary.failedTests) {
    return { status: "pass", message: "" };
  }
  const failed = report.tests?.find((t) => t.status === "fail");
  const fileError = report.files?.flatMap((f) => f.errors ?? [])[0];
  const message = failed
    ? `${failed.fullName ?? ""}: ${failed.errors?.[0]?.message ?? "failed"}`
    : (fileError?.message ?? (summary.tests ? `exit ${exitCode}` : "the file has no tests"));
  return { status: "fail", message: message.trim().slice(0, MAX_MESSAGE) };
}

export type Outcome =
  | { kind: "rejected"; reason: string }
  | { kind: "caught"; parent: RunResult; head: RunResult }
  | { kind: "missed"; parent: RunResult; head: RunResult };

/** A catch passes on the parent and fails on the head; a head timeout is not a catch. */
export function judge(parent: RunResult, head: RunResult): Outcome {
  const caught = parent.status === "pass" && head.status === "fail";
  return { kind: caught ? "caught" : "missed", parent, head };
}

/** A code fence longer than any backtick run in `text`. */
export function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(longest + 1);
}

/** Model-written prose: no @-mentions or HTML comments, bounded length. */
export function plain(text: string): string {
  return text
    .slice(0, MAX_BEHAVIOR)
    .replace(/@(?=[\w-])/g, "@\u200b")
    .replace(/<!--|-->/g, "")
    .trim();
}

export const MARKER = "<!-- moduo:catching-test -->";

export function commentBody(
  p: Proposal,
  outcome: Extract<Outcome, { kind: "caught" }>,
  shas: { parent: string; head: string },
): string {
  const lang = p.path.endsWith(".tsx") ? "tsx" : "ts";
  const msg = outcome.head.message || "failed";
  const codeFence = fence(p.code);
  const msgFence = fence(msg);
  return [
    MARKER,
    `**Catching test** · \`${p.path}\``,
    "",
    plain(p.behavior),
    "",
    `Passes on the parent (\`${shas.parent.slice(0, 9)}\`), fails on this PR (\`${shas.head.slice(0, 9)}\`):`,
    "",
    msgFence,
    msg,
    msgFence,
    "",
    "<details><summary>The test</summary>",
    "",
    `${codeFence}${lang}`,
    p.code.trimEnd(),
    codeFence,
    "",
    "</details>",
    "",
    "_Advisory (HV-27): if the change is intended, ignore this. If it isn't, the test is ready to add._",
  ].join("\n");
}

export function summary(rows: { path: string; outcome: Outcome }[], note: string): string {
  const describe = (o: Outcome) => {
    if (o.kind === "rejected") return `rejected: ${o.reason}`;
    const tag = o.kind === "caught" ? "**caught**" : "missed";
    return `${tag} · parent ${o.parent.status} · head ${o.head.status}`;
  };
  const lines = ["## Catching tests", ""];
  if (note.trim()) lines.push(plain(note), "");
  if (rows.length === 0) lines.push("No proposals.");
  else {
    lines.push("| Test | Outcome |", "| --- | --- |");
    for (const r of rows)
      lines.push(`| \`${r.path.replace(/\|/g, "")}\` | ${describe(r.outcome)} |`);
  }
  return lines.join("\n") + "\n";
}

/** Writes the test into `root`, runs its suite on it alone, and removes it again. */
export function runIn(root: string, p: Proposal): RunResult {
  const suite = suiteFor(p.path);
  if (!suite) return { status: "not-collected", message: "no suite" };
  const file = path.join(root, p.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, p.code);
  try {
    const cwd = path.join(root, suite.cwd);
    const filter = path.relative(cwd, file);
    const res = spawnSync(
      "bunx",
      ["rstest", "run", ...suite.args, filter, "--reporter", "json", "--passWithNoTests=false"],
      { cwd, encoding: "utf8", timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
    );
    const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    return parseRun(res.status, res.stdout ?? "", timedOut);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function arg(argv: string[], name: string, fallback?: string): string {
  const at = argv.indexOf(name);
  const value = at >= 0 ? argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function main(argv: string[]): void {
  const parentDir = path.resolve(arg(argv, "--parent"));
  const headDir = path.resolve(arg(argv, "--head"));
  const out = path.resolve(arg(argv, "--out"));
  const shas = {
    parent: arg(argv, "--parent-sha", "parent"),
    head: arg(argv, "--head-sha", "head"),
  };
  const input = JSON.parse(fs.readFileSync(arg(argv, "--tests"), "utf8")) as {
    tests?: Proposal[];
    note?: string;
  };
  const proposals = (Array.isArray(input.tests) ? input.tests : []).slice(0, MAX_TESTS);
  const exists = (f: string) =>
    fs.existsSync(path.join(parentDir, f)) || fs.existsSync(path.join(headDir, f));

  fs.mkdirSync(path.join(out, "comments"), { recursive: true });
  const seen = new Set<string>();
  const rows: { path: string; outcome: Outcome }[] = [];
  let caught = 0;
  for (const p of proposals) {
    const reason = rejectReason(p, exists, seen);
    const label = typeof p?.path === "string" ? p.path : "(no path)";
    if (reason) {
      rows.push({ path: label, outcome: { kind: "rejected", reason } });
      continue;
    }
    seen.add(p.path);
    const parent = runIn(parentDir, p);
    // A test that fails on the parent can't catch anything: skip the head run.
    const head: RunResult =
      parent.status === "pass" ? runIn(headDir, p) : { status: "skipped", message: "" };
    const outcome = judge(parent, head);
    rows.push({ path: p.path, outcome });
    if (outcome.kind === "caught") {
      caught += 1;
      fs.writeFileSync(path.join(out, "comments", `${caught}.md`), commentBody(p, outcome, shas));
    }
  }
  const note = typeof input.note === "string" ? input.note : "";
  fs.writeFileSync(path.join(out, "summary.md"), summary(rows, note));
  console.log(`caught=${caught}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
