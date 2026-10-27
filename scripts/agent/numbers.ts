/**
 * Weekly outcome numbers (Harness v3, HV-21, specs/harness-v3.md AC34): how the harness did last
 * week, from GitHub, git history and this machine's Entire metadata, written to one Moduo note.
 *
 *   first-pass CI   merged task PRs whose gate runs never went red (no failure, no re-run)
 *   follow-ups      fix PRs that touched code a task PR had changed in the 7 days before
 *   reverts         `Revert "…"` commits on develop/mike/maciej and merged Revert PRs
 *   escapes         benchmarks/escapes/<id>/escape.json added that week
 *   erosion         ratchet baseline drift, knowledge-file growth, ledger churn, and AI-review
 *                   threads left unresolved on merged Tier 2 PRs into develop
 *   usage           Entire token usage per block (sessions, API calls, tokens), plus skill calls
 *
 * Only numbers, PR numbers and the (already public) PR titles go into the note: no transcript,
 * prompt or branch without a PR is ever read into it, and `assertPublishable` refuses a body that
 * looks like it carries a secret. Entire is read only (`git cat-file` on the checkpoint refs'
 * metadata.json blobs); nothing here pushes or deletes `refs/entire/*`.
 *
 * CLI (one non-interactive command, for the HV-22 Monday routine):
 *   bun run numbers                     last full week (Mon–Sun, UTC): print it and write the note
 *   bun run numbers -- --week 2026-10-19   the week starting that Monday
 *   bun run numbers -- --dry-run        print the note, write nothing
 *   bun run numbers -- --json           print the computed numbers as JSON, write nothing
 *
 * Env: MODUO_MCP_KEY (the agent's own Moduo key; required unless --dry-run/--json),
 * MODUO_MCP_URL (default https://mcp.moduo.app). `gh` must be signed in.
 * Run with bun (extensionless imports, like wt.ts).
 */

import { isDocsOnly } from "../ci/tier";
import { blockIdFromTitle, type Rpc } from "./moduo-sync";

const DAY = 86_400_000;

// ── Inputs ───────────────────────────────────────────────────────────────

export interface Pr {
  number: number;
  title: string;
  url: string;
  state: string;
  baseRefName: string;
  headRefName: string;
  createdAt: string;
  mergedAt: string | null;
  labels: string[];
  files: string[];
}

export interface Run {
  name: string;
  event: string;
  headBranch: string;
  status: string;
  conclusion: string | null;
  runAttempt: number;
  createdAt: string;
}

export interface Session {
  checkpointId: string;
  sessionId: string;
  createdAt: string;
  branch: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  apiCalls: number;
  skills: string[];
}

export interface Ratchet {
  size: Record<string, number>;
  complexity: Record<string, number>;
}

export interface Facts {
  window: Window;
  prs: Pr[];
  runs: Run[];
  /** Subjects of commits on the shared branches inside the window. */
  sharedSubjects: string[];
  /** escape.json files added inside the window, with their id and who found them. */
  escapesAdded: { id: string; foundBy: string }[];
  escapesTotal: number;
  ratchetBefore: Ratchet | null;
  ratchetAfter: Ratchet | null;
  knowledgeBefore: number;
  knowledgeAfter: number;
  /** Unresolved AI-review threads per merged Tier 2 PR into develop (PR number → count). */
  reviewThreads: Record<number, number>;
  /** null when this machine has no Entire checkpoints (a cloud routine). */
  sessions: Session[] | null;
}

export interface Window {
  /** Monday 00:00 UTC, inclusive. */
  start: Date;
  /** The next Monday 00:00 UTC, exclusive. */
  end: Date;
}

// ── Window ───────────────────────────────────────────────────────────────

/** The Mon–Sun UTC week starting `week` (YYYY-MM-DD, a Monday), or the last full one before `now`. */
export function weekWindow(now: Date, week?: string): Window {
  if (week !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week))
      throw new Error(`--week needs YYYY-MM-DD, got "${week}"`);
    const start = new Date(`${week}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || start.getUTCDay() !== 1)
      throw new Error(`--week must be a Monday, got ${week}`);
    return { start, end: new Date(start.getTime() + 7 * DAY) };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const end = new Date(today - sinceMonday * DAY);
  return { start: new Date(end.getTime() - 7 * DAY), end };
}

export function inWindow(iso: string | null | undefined, w: Window): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= w.start.getTime() && t < w.end.getTime();
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── PR classes ───────────────────────────────────────────────────────────

export const SHARED_BRANCHES = new Set(["develop", "mike", "maciej"]);

/** A PR of one piece of work (not a personal → develop sync, a back-merge or a release PR). */
export function isTaskPr(pr: Pr): boolean {
  return !SHARED_BRANCHES.has(pr.headRefName) && !pr.headRefName.startsWith("release/");
}

const REVERT_TITLE = /^revert\b/i;
// "Fix …", "[ID] Fix …", "Notes: fix …", "fix(sync): …": a title that leads with the fix.
const FIX_TITLE = /^(\[[^\]]+\]\s*|[\w -]{1,24}:\s*)?(hot)?fix(es)?\b/i;
// "t/mike/fix-…", "hotfix/…", "…-fix".
const FIX_BRANCH = /(^|\/)(hot)?fix[-/]|-fix$/i;

export function isRevertPr(pr: Pr): boolean {
  return REVERT_TITLE.test(pr.title);
}

export function isFixPr(pr: Pr): boolean {
  if (isRevertPr(pr)) return false;
  return FIX_TITLE.test(pr.title) || FIX_BRANCH.test(pr.headRefName);
}

/** Task PRs merged inside the window, oldest first. */
export function mergedTaskPrs(prs: readonly Pr[], w: Window): Pr[] {
  return prs
    .filter((p) => isTaskPr(p) && inWindow(p.mergedAt, w))
    .sort((a, b) => Date.parse(a.mergedAt!) - Date.parse(b.mergedAt!));
}

// ── First-pass CI ────────────────────────────────────────────────────────

/** Workflows that label, review or deploy: never a pass/fail verdict on the code. */
export const NOT_A_GATE = new Set(["pr-tier", "ai-review", "moduo-sync"]);
const RED = new Set(["failure", "timed_out", "startup_failure"]);

export interface FirstPass {
  measured: number;
  passed: number;
  /** Merged task PRs with no gate run at all (nothing to judge). */
  unmeasured: number;
  red: { number: number; title: string }[];
}

function gateRunsFor(pr: Pr, runs: readonly Run[]): Run[] {
  // A branch name can be reused: only runs between the PR's opening (less an hour for the
  // push that preceded it) and its merge count.
  const from = Date.parse(pr.createdAt) - 3_600_000;
  const to = Date.parse(pr.mergedAt ?? pr.createdAt);
  return runs.filter((r) => {
    if (r.headBranch !== pr.headRefName || NOT_A_GATE.has(r.name)) return false;
    if (r.status !== "completed" || r.conclusion === "cancelled" || r.conclusion === "skipped")
      return false;
    const t = Date.parse(r.createdAt);
    return t >= from && t <= to;
  });
}

/** A run that failed, or was re-run (the list shows only the last attempt; a re-run means an earlier one failed). */
export function wentRed(r: Run): boolean {
  return RED.has(r.conclusion ?? "") || r.runAttempt > 1;
}

export function firstPass(prs: readonly Pr[], runs: readonly Run[], w: Window): FirstPass {
  const out: FirstPass = { measured: 0, passed: 0, unmeasured: 0, red: [] };
  for (const pr of mergedTaskPrs(prs, w)) {
    const gate = gateRunsFor(pr, runs);
    if (gate.length === 0) {
      out.unmeasured++;
      continue;
    }
    out.measured++;
    if (gate.some(wentRed)) out.red.push({ number: pr.number, title: pr.title });
    else out.passed++;
  }
  return out;
}

/** The `checks` workflow's push runs on develop/mike/maciej in the window: how often a shared branch went red. */
export function sharedBranchRuns(runs: readonly Run[], w: Window): { runs: number; red: number } {
  const own = runs.filter(
    (r) =>
      r.name === "checks" &&
      r.event === "push" &&
      SHARED_BRANCHES.has(r.headBranch) &&
      r.status === "completed" &&
      r.conclusion !== "cancelled" &&
      r.conclusion !== "skipped" &&
      inWindow(r.createdAt, w),
  );
  return { runs: own.length, red: own.filter(wentRed).length };
}

// ── Follow-up fixes ──────────────────────────────────────────────────────

/** Files whose overlap says nothing (lockfiles, release bookkeeping, the ratchet baseline). */
const NOISE =
  /^(bun\.lock|package\.json|VERSION|CHANGELOG\.md|scripts\/ci\/ratchets\.baseline\.json)$|^\.changes\//;

/** Code a follow-up can share with its original: not docs, not bookkeeping. */
export function codeFiles(files: readonly string[]): Set<string> {
  return new Set(
    files.filter((f) => !isDocsOnly(f) && !NOISE.test(f) && !f.endsWith("/package.json")),
  );
}

export interface FollowUp {
  fix: { number: number; title: string };
  original: { number: number; title: string };
  shared: number;
}

/** The latest task PR merged in the 7 days before `fix` that changed code `fix` touches, or null. */
function originalOf(fix: Pr, earlier: readonly Pr[]): { pr: Pr; shared: number } | null {
  const touched = codeFiles(fix.files);
  if (touched.size === 0) return null;
  const at = Date.parse(fix.mergedAt!);
  let best: { pr: Pr; shared: number } | null = null;
  for (const pr of earlier) {
    const t = Date.parse(pr.mergedAt!);
    if (pr.number === fix.number || t >= at || t < at - 7 * DAY) continue;
    const shared = pr.files.filter((f) => touched.has(f)).length;
    if (shared > 0 && (!best || t > Date.parse(best.pr.mergedAt!))) best = { pr, shared };
  }
  return best;
}

/** Fix PRs merged in the window that follow up a task PR merged in the 7 days before them. */
export function followUps(prs: readonly Pr[], w: Window): FollowUp[] {
  const lookback: Window = { start: new Date(w.start.getTime() - 7 * DAY), end: w.end };
  const candidates = mergedTaskPrs(prs, lookback);
  const out: FollowUp[] = [];
  for (const fix of mergedTaskPrs(prs, w).filter(isFixPr)) {
    const hit = originalOf(fix, candidates);
    if (!hit) continue;
    out.push({
      fix: { number: fix.number, title: fix.title },
      original: { number: hit.pr.number, title: hit.pr.title },
      shared: hit.shared,
    });
  }
  return out;
}

// ── Reverts ──────────────────────────────────────────────────────────────

/** What a revert names: `Revert "x"` → x. One revert reaching two branches counts once. */
function revertedTitle(subject: string): string | null {
  const m = /^Revert "(.+)"\s*$/.exec(subject.trim());
  if (m) return m[1]!;
  return REVERT_TITLE.test(subject.trim()) ? subject.trim() : null;
}

export function reverts(subjects: readonly string[], prs: readonly Pr[], w: Window): string[] {
  const titles = new Set<string>();
  for (const s of subjects) {
    const t = revertedTitle(s);
    if (t) titles.add(t);
  }
  for (const pr of mergedTaskPrs(prs, w).filter(isRevertPr)) {
    const t = revertedTitle(pr.title);
    if (t) titles.add(t);
  }
  return [...titles].sort();
}

// ── Erosion ──────────────────────────────────────────────────────────────

export interface RatchetDrift {
  /** Entries frozen at the end that weren't at the start. */
  added: number;
  /** Entries whose frozen value went up. */
  raised: number;
  /** Entries lowered or removed (splits, `--tighten`). */
  eased: number;
}

function driftOf(before: Record<string, number>, after: Record<string, number>, d: RatchetDrift) {
  for (const [k, v] of Object.entries(after)) {
    const was = before[k];
    if (was === undefined) d.added++;
    else if (v > was) d.raised++;
    else if (v < was) d.eased++;
  }
  for (const k of Object.keys(before)) if (!(k in after)) d.eased++;
}

/** null when the baseline didn't exist at the start of the window (first frozen that week). */
export function ratchetDrift(before: Ratchet | null, after: Ratchet | null): RatchetDrift | null {
  if (!before || !after) return null;
  const d: RatchetDrift = { added: 0, raised: 0, eased: 0 };
  driftOf(before.size, after.size, d);
  driftOf(before.complexity, after.complexity, d);
  return d;
}

/** Ledger and knowledge files (the audit's "42% of commits" measure). */
const LEDGER =
  /^(specs\/BUILD_ORDER\.md|specs\/BUILD_LOG\.md|docs\/decisions(\.md|\/)|docs\/gotchas(\.md|\/))/;

/** Share of merged task PRs that touched a ledger or knowledge file. */
export function ledgerChurn(prs: readonly Pr[], w: Window): { touched: number; of: number } {
  const merged = mergedTaskPrs(prs, w);
  return {
    touched: merged.filter((p) => p.files.some((f) => LEDGER.test(f))).length,
    of: merged.length,
  };
}

// ── Usage per block ──────────────────────────────────────────────────────

export interface Usage {
  key: string;
  /** The PR the key comes from, when there is one. */
  pr?: number;
  sessions: number;
  apiCalls: number;
  outputTokens: number;
  /** Input plus cache writes: the tokens read fresh. */
  freshInputTokens: number;
  cacheReadTokens: number;
}

/** The newest PR per head branch. */
function prByBranch(prs: readonly Pr[]): Map<string, Pr> {
  const map = new Map<string, Pr>();
  for (const pr of prs) {
    const had = map.get(pr.headRefName);
    if (!had || Date.parse(pr.createdAt) > Date.parse(had.createdAt)) map.set(pr.headRefName, pr);
  }
  return map;
}

/** Where a session's tokens go: its block ID, else its PR, else a bucket (no branch name leaks out). */
export function usageKey(branch: string, byBranch: Map<string, Pr>): { key: string; pr?: number } {
  if (SHARED_BRANCHES.has(branch)) return { key: "(on a shared branch)" };
  const pr = byBranch.get(branch);
  if (!pr) return { key: "(no PR)" };
  return { key: blockIdFromTitle(pr.title) ?? `#${pr.number}`, pr: pr.number };
}

function addSession(u: Usage, s: Session, seen: Set<string>): void {
  if (!seen.has(s.sessionId)) {
    seen.add(s.sessionId);
    u.sessions++;
  }
  u.apiCalls += s.apiCalls;
  u.outputTokens += s.outputTokens;
  u.freshInputTokens += s.inputTokens + s.cacheCreationTokens;
  u.cacheReadTokens += s.cacheReadTokens;
}

/** Token usage grouped by block, biggest output first. */
export function usageByBlock(sessions: readonly Session[], prs: readonly Pr[], w: Window): Usage[] {
  const byBranch = prByBranch(prs);
  const groups = new Map<string, { u: Usage; seen: Set<string> }>();
  for (const s of sessions) {
    if (!inWindow(s.createdAt, w)) continue;
    const { key, pr } = usageKey(s.branch, byBranch);
    let g = groups.get(key);
    if (!g) {
      const u: Usage = {
        key,
        pr,
        sessions: 0,
        apiCalls: 0,
        outputTokens: 0,
        freshInputTokens: 0,
        cacheReadTokens: 0,
      };
      g = { u, seen: new Set() };
      groups.set(key, g);
    }
    addSession(g.u, s, g.seen);
  }
  return [...groups.values()].map((g) => g.u).sort((a, b) => b.outputTokens - a.outputTokens);
}

/** The skills AC15 wants to see called. */
export const WATCHED_SKILLS = ["tdd", "diagnosing-bugs", "code-review", "pr"] as const;

/** Skill calls in the window by bare name (plugin prefixes dropped). */
export function skillCalls(sessions: readonly Session[], w: Window): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    if (!inWindow(s.createdAt, w)) continue;
    for (const name of s.skills) {
      const bare = name.split(":").pop()!;
      out[bare] = (out[bare] ?? 0) + 1;
    }
  }
  return out;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

// ── All numbers ──────────────────────────────────────────────────────────

export interface Numbers {
  week: { start: string; end: string };
  merged: { task: number; block: number; tiers: Record<string, number> };
  firstPass: FirstPass;
  sharedBranch: { runs: number; red: number };
  followUps: FollowUp[];
  reverts: string[];
  escapes: { added: { id: string; foundBy: string }[]; total: number };
  erosion: {
    ratchet: RatchetDrift | null;
    knowledgeBytes: { before: number; after: number };
    ledger: { touched: number; of: number };
    unresolvedReview: { prs: number; threads: number };
  };
  usage: { blocks: Usage[]; skills: Record<string, number> } | null;
}

function tierMix(prs: readonly Pr[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pr of prs) {
    const tier = pr.labels.find((l) => /^tier-\d$/.test(l)) ?? "unlabelled";
    out[tier] = (out[tier] ?? 0) + 1;
  }
  return out;
}

export function compute(f: Facts): Numbers {
  const w = f.window;
  const merged = mergedTaskPrs(f.prs, w);
  const threads = Object.values(f.reviewThreads);
  return {
    week: { start: isoDay(w.start), end: isoDay(new Date(w.end.getTime() - DAY)) },
    merged: {
      task: merged.length,
      block: merged.filter((p) => blockIdFromTitle(p.title)).length,
      tiers: tierMix(merged),
    },
    firstPass: firstPass(f.prs, f.runs, w),
    sharedBranch: sharedBranchRuns(f.runs, w),
    followUps: followUps(f.prs, w),
    reverts: reverts(f.sharedSubjects, f.prs, w),
    escapes: { added: f.escapesAdded, total: f.escapesTotal },
    erosion: {
      ratchet: ratchetDrift(f.ratchetBefore, f.ratchetAfter),
      knowledgeBytes: { before: f.knowledgeBefore, after: f.knowledgeAfter },
      ledger: ledgerChurn(f.prs, w),
      unresolvedReview: {
        prs: threads.filter((n) => n > 0).length,
        threads: threads.reduce((a, b) => a + b, 0),
      },
    },
    usage: f.sessions
      ? { blocks: usageByBlock(f.sessions, f.prs, w), skills: skillCalls(f.sessions, w) }
      : null,
  };
}

// ── The note ─────────────────────────────────────────────────────────────

export function noteTitle(n: Numbers): string {
  return `Weekly numbers · ${n.week.start} → ${n.week.end}`;
}

/** The parent note every week's note nests under. */
export const PARENT_TITLE = "Harness weekly numbers";

function pct(part: number, of: number): string {
  return of === 0 ? "n/a" : `${Math.round((100 * part) / of)}%`;
}

function tokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** Titles go into a Markdown table or list: no pipes, no line breaks, bounded length. */
function clean(title: string): string {
  const t = title.replace(/[|\r\n]+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 89)}…` : t;
}

function headline(n: Numbers): string[] {
  const fp = n.firstPass;
  const er = n.erosion;
  const r = er.ratchet;
  const ratchet = r
    ? `${r.added} new, ${r.raised} raised, ${r.eased} eased`
    : "baseline new this week";
  const blocks = n.usage?.blocks.filter((b) => b.pr !== undefined && !b.key.startsWith("#")) ?? [];
  const usage = n.usage
    ? `${blocks.length} blocks · median ${tokens(median(blocks.map((b) => b.outputTokens)))} output tokens per block`
    : "no Entire data on this machine";
  return [
    "| Number | This week |",
    "| --- | --- |",
    `| Task PRs merged | ${n.merged.task} (${n.merged.block} through the block flow, ${pct(n.merged.block, n.merged.task)}) |`,
    `| First-pass CI rate | ${pct(fp.passed, fp.measured)} (${fp.passed} of ${fp.measured}; ${fp.unmeasured} had no gate run) |`,
    `| Shared branches red | ${n.sharedBranch.red} of ${n.sharedBranch.runs} checks runs |`,
    `| Follow-up fixes within 7 days | ${n.followUps.length} (${pct(n.followUps.length, n.merged.task)} of task PRs) |`,
    `| Reverts | ${n.reverts.length} |`,
    `| Escapes | ${n.escapes.added.length} new (${n.escapes.total} in the benchmark) |`,
    `| Ratchet drift | ${ratchet} |`,
    `| Knowledge files | ${kb(er.knowledgeBytes.before)} → ${kb(er.knowledgeBytes.after)} |`,
    `| PRs touching ledger or knowledge | ${pct(er.ledger.touched, er.ledger.of)} (${er.ledger.touched} of ${er.ledger.of}) |`,
    `| Unresolved AI-review threads, Tier 2 into develop | ${er.unresolvedReview.threads} on ${er.unresolvedReview.prs} PRs |`,
    `| Usage | ${usage} |`,
  ];
}

function prList(heading: string, rows: string[]): string[] {
  return rows.length === 0 ? [] : ["", `### ${heading}`, "", ...rows];
}

function usageTable(n: Numbers): string[] {
  if (!n.usage) return [];
  const rows = n.usage.blocks
    .slice(0, 15)
    .map(
      (u) =>
        `| ${u.key} | ${u.sessions} | ${u.apiCalls} | ${tokens(u.outputTokens)} | ${tokens(u.freshInputTokens)} | ${tokens(u.cacheReadTokens)} |`,
    );
  const skills = WATCHED_SKILLS.map((s) => `${s} ${n.usage!.skills[s] ?? 0}`).join(" · ");
  return [
    "",
    "### Usage per block (this machine's Entire sessions)",
    "",
    "| Block | Sessions | API calls | Output | Fresh input | Cache reads |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `Skill calls (AC15): ${skills}.`,
  ];
}

const DEFINITIONS = [
  "",
  "### How these are counted",
  "",
  "- **Task PR**: a merged PR whose head isn't develop, mike, maciej or a release branch (syncs, back-merges and release PRs are left out). **Block flow**: its title starts with `[ID]`.",
  "- **First-pass CI**: every gate run on the PR's branch between opening and merge succeeded on its first attempt (pr-tier, ai-review and moduo-sync aren't gates). PRs into a personal branch run only the light gates; the full suite runs on PRs into develop and on pushes, counted in **Shared branches red**.",
  "- **Follow-up fix**: a PR whose title leads with Fix (or whose branch is a fix branch) that changed code (not docs, lockfiles or bookkeeping) a task PR had changed in the 7 days before it. A heuristic: the pairs are listed so a person can judge them.",
  "- **Escapes**: `benchmarks/escapes/*/escape.json` added this week. **Ratchet drift**: entries of `scripts/ci/ratchets.baseline.json` added or raised (erosion) vs lowered or removed. **Knowledge files**: `docs/decisions*`, `docs/gotchas*` and `.claude/rules/` on mike.",
  "- **Usage**: token counts from the Entire checkpoint metadata on the machine that ran this (other people's sessions aren't in it), grouped by the PR of the session's branch. Written by `bun run numbers` (scripts/agent/numbers.ts).",
];

export function renderNote(n: Numbers): string {
  const fp = n.firstPass.red.map((p) => `- #${p.number} ${clean(p.title)}`);
  const fu = n.followUps.map(
    (f) =>
      `- #${f.fix.number} ${clean(f.fix.title)} → follows #${f.original.number} ${clean(f.original.title)} (${f.shared} shared files)`,
  );
  const rv = n.reverts.map((t) => `- ${clean(t)}`);
  const es = n.escapes.added.map((e) => `- ${e.id} (found by ${clean(e.foundBy)})`);
  const tiers = Object.entries(n.merged.tiers)
    .sort()
    .map(([t, c]) => `${t} ${c}`)
    .join(" · ");
  return [
    `Week ${n.week.start} to ${n.week.end} (UTC). Tier mix of task PRs: ${tiers || "none"}.`,
    "",
    ...headline(n),
    ...prList("Went red before merging", fp),
    ...prList("Follow-up fixes", fu),
    ...prList("Reverts", rv),
    ...prList("New escapes", es),
    ...usageTable(n),
    ...DEFINITIONS,
    "",
  ].join("\n");
}

/** Shapes of credentials that must never reach a note (the repo and the note may be quoted publicly). */
const SECRET_SHAPES: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9-_]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(sb_secret|sb_publishable|mdo|moduo)_[A-Za-z0-9]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export function assertPublishable(markdown: string): void {
  const hit = SECRET_SHAPES.find((re) => re.test(markdown));
  if (hit)
    throw new Error(
      `The note looks like it carries a secret (${hit.source}); nothing was written.`,
    );
}

// ── Moduo writer ─────────────────────────────────────────────────────────

interface NoteRow {
  id: string;
  title: string;
}

/** notes_search / notes_list answer an array or `{ notes: [...] }`; either way, the rows. */
function rowsOf(answer: unknown): NoteRow[] {
  if (Array.isArray(answer)) return answer as NoteRow[];
  const notes = (answer as { notes?: unknown } | null)?.notes;
  return Array.isArray(notes) ? (notes as NoteRow[]) : [];
}

/** The live note titled exactly `title`, by full-text search (the tree listing stops at 200). */
async function findNote(rpc: Rpc, title: string): Promise<NoteRow | undefined> {
  const rows = rowsOf(await rpc("notes_search", { query: `"${title}"`, limit: 50 }));
  return rows.find((r) => r.title === title);
}

/** A top-level note that holds one child note per run (title + the text it starts with). */
export interface ParentNote {
  title: string;
  intro: string;
}

const NUMBERS_PARENT: ParentNote = {
  title: PARENT_TITLE,
  intro:
    "One child note per week: the harness's outcome numbers (specs/harness-v3.md AC34), written every Monday by `bun run numbers`.",
};

async function ensureParent(rpc: Rpc, parent: ParentNote): Promise<string> {
  const had = await findNote(rpc, parent.title);
  if (had) return had.id;
  const made = (await rpc("notes_create", {
    title: parent.title,
    markdown: parent.intro,
  })) as { id: string };
  return made.id;
}

/**
 * Writes the week's note under the parent: updates it when this week's note already exists (a
 * re-run replaces it), else creates it. Returns the note id and what happened. The weekly retro
 * (HV-22) passes its own parent.
 */
export async function writeNote(
  rpc: Rpc,
  title: string,
  markdown: string,
  parentNote: ParentNote = NUMBERS_PARENT,
): Promise<{ id: string; action: "created" | "updated" }> {
  assertPublishable(markdown);
  const parent = await ensureParent(rpc, parentNote);
  const had = await findNote(rpc, title);
  if (had) {
    await rpc("notes_update", { note_id: had.id, title, markdown });
    return { id: had.id, action: "updated" };
  }
  const made = (await rpc("notes_create", { title, markdown, parent_id: parent })) as {
    id: string;
  };
  return { id: made.id, action: "created" };
}

// ── CLI ──────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<void> {
  const weekAt = argv.indexOf("--week");
  const w = weekWindow(new Date(), weekAt >= 0 ? argv[weekAt + 1] : undefined);
  // Loaded here, so the tests import the pure half without the I/O half.
  const { gatherFacts } = await import("./numbers-sources");
  const n = compute(gatherFacts(w));
  if (argv.includes("--json")) {
    console.log(JSON.stringify(n, null, 2));
    return;
  }
  const title = noteTitle(n);
  const markdown = renderNote(n);
  assertPublishable(markdown);
  console.log(`# ${title}\n\n${markdown}`);
  if (argv.includes("--dry-run")) return;
  const key = process.env.MODUO_MCP_KEY ?? "";
  if (!key)
    throw new Error("MODUO_MCP_KEY is not set (the agent's own Moduo key); nothing was written.");
  const { connectorRpc } = await import("./moduo-sync");
  const rpc = connectorRpc(process.env.MODUO_MCP_URL || "https://mcp.moduo.app", key);
  const done = await writeNote(rpc, title, markdown);
  console.log(`numbers: note ${done.action} in Moduo: "${title}" (${done.id})`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`numbers: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
