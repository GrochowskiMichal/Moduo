/**
 * The facts `numbers.ts` computes from (HV-21): GitHub through `gh`, git history of the shared
 * branches, and this machine's Entire checkpoint metadata. Read only: it fetches the shared
 * branches and never pushes, deletes or rewrites anything (`refs/entire/*` included). Only each
 * checkpoint's metadata.json is read, never a transcript or prompt.
 */

import { execFileSync, spawnSync } from "node:child_process";

import type { Facts, Pr, Ratchet, Run, Session, Window } from "./numbers";

const DAY = 86_400_000;
const SHARED = ["develop", "mike", "maciej"] as const;

function sh(cmd: string, args: readonly string[]): string {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function lines(out: string): string[] {
  return out.split("\n").filter(Boolean);
}

// ── GitHub ───────────────────────────────────────────────────────────────

const PR_FIELDS = "number,title,url,state,baseRefName,headRefName,createdAt,mergedAt,labels,files";

/** `cmd` once more after a failure: GitHub's GraphQL answers a large page with a 502 now and then. */
function shRetry(cmd: string, args: readonly string[]): string {
  try {
    return sh(cmd, args);
  } catch {
    return sh(cmd, args);
  }
}

/** PRs last updated on one UTC day (each PR has one last update, so the days don't overlap). */
function prsUpdatedOn(day: string): any[] {
  const args = ["pr", "list", "--state", "all", "--limit", "1000"];
  const raw = shRetry("gh", [...args, "--search", `updated:${day}`, "--json", PR_FIELDS]);
  return JSON.parse(raw) as any[];
}

/**
 * Every PR touched since a week before the window (merged ones in the lookback included), a day
 * per query up to today: one query with files for a fortnight of PRs is too big for GitHub.
 */
export function githubPrs(w: Window): Pr[] {
  const raw: any[] = [];
  for (let t = w.start.getTime() - 8 * DAY; t <= Date.now(); t += DAY)
    raw.push(...prsUpdatedOn(new Date(t).toISOString().slice(0, 10)));
  return raw.map((p) => ({
    number: p.number,
    title: p.title,
    url: p.url,
    state: p.state,
    baseRefName: p.baseRefName,
    headRefName: p.headRefName,
    createdAt: p.createdAt,
    mergedAt: p.mergedAt || null,
    labels: (p.labels ?? []).map((l: { name: string }) => l.name),
    files: (p.files ?? []).map((f: { path: string }) => f.path),
  }));
}

const RUN_JQ =
  '.workflow_runs[] | [.name, .event, .head_branch, .status, (.conclusion // ""), .run_attempt, .created_at] | @tsv';

/** Workflow runs from a week before the window to its end, a day per query (the API stops at 1000 a query). */
export function githubRuns(w: Window): Run[] {
  const out: Run[] = [];
  for (let t = w.start.getTime() - 8 * DAY; t < w.end.getTime(); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    const raw = shRetry("gh", [
      "api",
      "--paginate",
      `repos/{owner}/{repo}/actions/runs?created=${day}&per_page=100`,
      "-q",
      RUN_JQ,
    ]);
    for (const l of lines(raw)) {
      const [name, event, headBranch, status, conclusion, attempt, createdAt] = l.split("\t");
      out.push({
        name: name!,
        event: event!,
        headBranch: headBranch!,
        status: status!,
        conclusion: conclusion || null,
        runAttempt: Number(attempt),
        createdAt: createdAt!,
      });
    }
  }
  return out;
}

const THREADS_QUERY = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
  reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}}}}`;

/** Unresolved AI-review threads on each merged Tier 2 PR into develop in the window. */
export function reviewThreads(prs: readonly Pr[], w: Window): Record<number, number> {
  const [owner, repo] = sh("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ])
    .trim()
    .split("/");
  const out: Record<number, number> = {};
  for (const pr of prs) {
    const t = Date.parse(pr.mergedAt ?? "");
    if (pr.baseRefName !== "develop" || !pr.labels.includes("tier-2")) continue;
    if (!(t >= w.start.getTime() && t < w.end.getTime())) continue;
    const raw = sh("gh", [
      "api",
      "graphql",
      "-f",
      `query=${THREADS_QUERY}`,
      "-F",
      `o=${owner}`,
      "-F",
      `r=${repo}`,
      "-F",
      `n=${pr.number}`,
      "-q",
      '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not) | .comments.nodes[0].author.login] | map(select(test("claude|github-actions"; "i"))) | length',
    ]);
    out[pr.number] = Number(raw.trim()) || 0;
  }
  return out;
}

// ── git ──────────────────────────────────────────────────────────────────

/** The shared branches that exist on origin, freshly fetched (a failed fetch keeps what's there). */
export function sharedRefs(): string[] {
  try {
    sh("git", ["fetch", "--quiet", "origin", ...SHARED]);
  } catch {
    // Offline: the last fetched state is still a fair answer.
  }
  return SHARED.map((b) => `origin/${b}`).filter((ref) => {
    try {
      sh("git", ["rev-parse", "--verify", "--quiet", ref]);
      return true;
    } catch {
      return false;
    }
  });
}

/** The ref's tip as it stood at `at` (its first-parent line, so merge times count), or null. */
export function revAt(ref: string, at: Date): string | null {
  const rev = sh("git", [
    "rev-list",
    "-1",
    "--first-parent",
    `--before=${at.toISOString()}`,
    ref,
  ]).trim();
  return rev || null;
}

/** Subjects of every commit that reached a shared branch inside the window. */
export function sharedSubjects(refs: readonly string[], w: Window): string[] {
  const out = new Set<string>();
  for (const ref of refs) {
    const from = revAt(ref, w.start);
    const to = revAt(ref, w.end);
    if (!to) continue;
    const range = from ? `${from}..${to}` : to;
    for (const s of lines(sh("git", ["log", "--format=%s", range]))) out.add(s);
  }
  return [...out];
}

function escapePaths(rev: string | null): string[] {
  if (!rev) return [];
  return lines(sh("git", ["ls-tree", "-r", "--name-only", rev, "--", "benchmarks/escapes"])).filter(
    (p) => p.endsWith("/escape.json"),
  );
}

/** Escapes on any shared branch at the end of the window that none had at its start. */
export function escapes(
  refs: readonly string[],
  w: Window,
): Pick<Facts, "escapesAdded" | "escapesTotal"> {
  const before = new Set<string>();
  const after = new Map<string, string>();
  for (const ref of refs) {
    for (const p of escapePaths(revAt(ref, w.start))) before.add(p);
    const end = revAt(ref, w.end);
    for (const p of escapePaths(end)) if (!after.has(p)) after.set(p, end!);
  }
  const escapesAdded = [...after]
    .filter(([p]) => !before.has(p))
    .map(([p, rev]) => {
      const json = JSON.parse(sh("git", ["show", `${rev}:${p}`])) as {
        id?: string;
        foundBy?: string;
      };
      return { id: json.id ?? p.split("/")[2]!, foundBy: json.foundBy ?? "unknown" };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return { escapesAdded, escapesTotal: after.size };
}

export function ratchetAt(rev: string | null): Ratchet | null {
  if (!rev) return null;
  try {
    const json = JSON.parse(sh("git", ["show", `${rev}:scripts/ci/ratchets.baseline.json`]));
    return { size: json.size ?? {}, complexity: json.complexity ?? {} };
  } catch {
    return null;
  }
}

const KNOWLEDGE = [
  "docs/decisions",
  "docs/decisions.md",
  "docs/gotchas",
  "docs/gotchas.md",
  ".claude/rules",
];

/** Bytes of decisions, gotchas and path rules at a revision. */
export function knowledgeBytes(rev: string | null): number {
  if (!rev) return 0;
  return lines(sh("git", ["ls-tree", "-r", "-l", rev, "--", ...KNOWLEDGE])).reduce((sum, l) => {
    const size = Number(l.split(/\s+/)[3]);
    return sum + (Number.isFinite(size) ? size : 0);
  }, 0);
}

// ── Entire (read only) ───────────────────────────────────────────────────

/** `git cat-file --batch` over many `<ref>:<path>` names; missing ones come back undefined. */
export function catFiles(names: readonly string[]): (string | undefined)[] {
  if (names.length === 0) return [];
  const res = spawnSync("git", ["cat-file", "--batch"], {
    input: names.join("\n") + "\n",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`git cat-file: ${res.stderr.toString().slice(0, 200)}`);
  return parseBatch(res.stdout, names.length);
}

/** Splits `git cat-file --batch` output into one body (or undefined, for a missing object) per name. */
export function parseBatch(buf: Buffer, count: number): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  let at = 0;
  while (out.length < count && at < buf.length) {
    const nl = buf.indexOf(10, at);
    const header = buf.subarray(at, nl).toString();
    at = nl + 1;
    const size = Number(header.split(" ")[2]);
    if (header.endsWith(" missing") || header.endsWith(" ambiguous") || !Number.isFinite(size)) {
      out.push(undefined);
      continue;
    }
    out.push(buf.subarray(at, at + size).toString());
    at += size + 1;
  }
  return out;
}

function toSession(raw: any): Session {
  const u = raw.token_usage ?? {};
  return {
    checkpointId: String(raw.checkpoint_id ?? ""),
    sessionId: String(raw.session_id ?? ""),
    createdAt: String(raw.created_at ?? ""),
    branch: String(raw.branch ?? ""),
    inputTokens: Number(u.input_tokens ?? 0),
    cacheCreationTokens: Number(u.cache_creation_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    apiCalls: Number(u.api_call_count ?? 0),
    skills: (raw.skill_events ?? []).map((e: any) => String(e?.skill?.name ?? "")).filter(Boolean),
  };
}

/** Each checkpoint session's metadata from the local Entire refs, or null when there are none. */
export function entireSessions(): Session[] | null {
  const refs = lines(sh("git", ["for-each-ref", "--format=%(refname)", "refs/entire/checkpoints"]));
  if (refs.length === 0) return null;
  const roots = catFiles(refs.map((r) => `${r}:metadata.json`));
  const names: string[] = [];
  roots.forEach((body, i) => {
    if (!body) return;
    const sessions = (JSON.parse(body).sessions ?? []) as { metadata?: string }[];
    for (const s of sessions)
      if (s.metadata) names.push(`${refs[i]}:${s.metadata.replace(/^\//, "")}`);
  });
  return catFiles(names)
    .filter((b): b is string => b !== undefined)
    .map((b) => toSession(JSON.parse(b)));
}

// ── Everything ───────────────────────────────────────────────────────────

export function gatherFacts(w: Window): Facts {
  const refs = sharedRefs();
  const prs = githubPrs(w);
  const mike = refs.includes("origin/mike") ? "origin/mike" : refs[0];
  const before = mike ? revAt(mike, w.start) : null;
  const after = mike ? revAt(mike, w.end) : null;
  return {
    window: w,
    prs,
    runs: githubRuns(w),
    sharedSubjects: sharedSubjects(refs, w),
    ...escapes(refs, w),
    ratchetBefore: ratchetAt(before),
    ratchetAfter: ratchetAt(after),
    knowledgeBefore: knowledgeBytes(before),
    knowledgeAfter: knowledgeBytes(after),
    reviewThreads: reviewThreads(prs, w),
    sessions: entireSessions(),
  };
}
