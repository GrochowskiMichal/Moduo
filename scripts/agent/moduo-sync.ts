// GitHub → Moduo sync (Harness v3, HV-7, specs/harness-v3.md AC11): GitHub
// events move a block's Moduo task through its stages, with no model call.
//
//   draft PR "[ID] …" opened or reopened, or converted to draft → Building
//   PR opened or reopened ready, or marked ready for review      → In review
//   PR merged                                                     → Awaiting release
//   PR closed unmerged (no other open PR for the ID)              → To do, with a comment
//   release vX.Y.Z (release.yml succeeded)                        → Shipped, for every
//                                                                   "[ID]" merged since the
//                                                                   previous v* tag
//
// The block's task is the live task whose title starts with "<ID> — " or ends
// with "(<ID>)" (the moduo-agent skill's rule). A PR whose title doesn't start
// with "[ID]", a task that isn't found (or is found twice), and a task already
// done or won't do make no call. Run by .github/workflows/moduo-sync.yml:
//
//   bun scripts/agent/moduo-sync.ts            reads $GITHUB_EVENT_NAME and $GITHUB_EVENT_PATH
//   bun scripts/agent/moduo-sync.ts --dry-run  prints the plan, calls nothing
//
// Env: MODUO_CI_KEY (the CI agent's key; unset → a notice and exit 0),
// MODUO_MCP_URL (default https://mcp.moduo.app), GITHUB_TOKEN + GITHUB_REPOSITORY
// (the open-PR lookup for a closed PR). Erasable TypeScript only: node and bun run it.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Stage = "Building" | "In review" | "Awaiting release" | "To do" | "Shipped";

/** The category word for each stage, for a project that lacks the stage's name. */
export const STAGE_CATEGORY: Record<Stage, string> = {
  Building: "in_progress",
  "In review": "in_progress",
  "Awaiting release": "in_progress",
  "To do": "todo",
  Shipped: "done",
};

export interface Move {
  id: string;
  status: Stage;
  /** Posted on the task after the move. */
  comment?: string;
  /** Why, for the log. */
  reason: string;
}

export interface PrFacts {
  action: string;
  number: number;
  title: string;
  draft: boolean;
  merged: boolean;
  url: string;
  /** The title before an `edited` event, when the title changed. */
  previousTitle?: string;
  /** "open" or "closed"; a retitled closed PR moves nothing. */
  state?: string;
}

// "[HV-7] …", "[TV-D16] …", "[CV-2-fix] …": an upper-case prefix, then dash-joined parts.
const ID_IN_BRACKETS = /^\[([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+)\]/;

/** The block ID a PR title starts with, or null. */
export function blockIdFromTitle(title: string): string | null {
  return ID_IN_BRACKETS.exec(title.trim())?.[1] ?? null;
}

/**
 * The one move a pull_request event makes, or null. `openTitles` are the
 * titles of the repo's other open PRs: a closed PR whose block another open PR
 * still carries (a replacement) leaves the task where it is.
 */
export function planPullRequest(pr: PrFacts, openTitles: readonly string[] = []): Move | null {
  const id = blockIdFromTitle(pr.title);
  if (!id) return null;
  const at = `PR #${pr.number}`;
  const openStage: Stage = pr.draft ? "Building" : "In review";
  switch (pr.action) {
    case "opened":
    case "reopened":
      return {
        id,
        status: openStage,
        reason: `${at} ${pr.action}${pr.draft ? " as a draft" : ""}`,
      };
    case "edited":
      // Only a title that newly names this block counts as opening it.
      if (pr.state === "closed" || pr.previousTitle === undefined) return null;
      if (blockIdFromTitle(pr.previousTitle) === id) return null;
      return { id, status: openStage, reason: `${at} retitled to ${id}` };
    case "converted_to_draft":
      return { id, status: "Building", reason: `${at} back to draft` };
    case "ready_for_review":
      return { id, status: "In review", reason: `${at} ready for review` };
    case "closed": {
      if (pr.merged) return { id, status: "Awaiting release", reason: `${at} merged` };
      const other = openTitles.some((t) => blockIdFromTitle(t) === id);
      if (other) return null;
      return {
        id,
        status: "To do",
        reason: `${at} closed unmerged`,
        comment: `PR #${pr.number} was closed without merging, so this block is back in To do. ${pr.url}`,
      };
    }
    default:
      return null;
  }
}

/** Every block ID that starts a line of a commit log ("[ID] title", as GitHub's merge and squash messages carry it). */
export function blockIdsInLog(log: string): string[] {
  const ids = new Set<string>();
  for (const line of log.split("\n")) {
    const id = blockIdFromTitle(line);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

export function planRelease(tag: string, ids: readonly string[]): Move[] {
  return ids.map((id) => ({ id, status: "Shipped" as const, reason: `released in ${tag}` }));
}

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** The commit messages between the previous v* tag and `tag` (all history for the first one). */
export function releaseLog(tag: string, cwd?: string): string {
  if (!RELEASE_TAG.test(tag)) throw new Error(`Not a release tag: ${tag}`);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  let range = tag;
  try {
    const prev = git("describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`).trim();
    if (prev) range = `${prev}..${tag}`;
  } catch {
    // No earlier tag: the whole history is this release.
  }
  return git("log", "--format=%B", range);
}

// ── Moduo ────────────────────────────────────────────────────────────────

export type Rpc = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

interface TaskRow {
  handle?: string;
  id: string;
  title: string;
  status_category?: string;
  project_archived?: boolean;
}

/** The live task that is the block's, by the moduo-agent title rule. */
export function pickBlockTask(
  rows: readonly TaskRow[],
  id: string,
): TaskRow | "none" | "ambiguous" {
  const hits = rows.filter((r) => {
    if (r.project_archived) return false;
    const title = r.title.trim();
    return title.startsWith(`${id} — `) || title.endsWith(`(${id})`);
  });
  if (hits.length === 0) return "none";
  if (hits.length > 1) return "ambiguous";
  return hits[0]!;
}

const CLOSED = new Set(["done", "wont_do"]);

export interface Outcome {
  move: Move;
  result: "moved" | "no task" | "ambiguous" | "closed" | "failed";
  task?: string;
  error?: string;
}

/** Moves one found task, falling back to the stage's category word. */
async function setStage(rpc: Rpc, ref: string, status: Stage): Promise<void> {
  try {
    await rpc("tasks_set_status", { task_id: ref, status });
  } catch (err) {
    // A project without the stage's name takes the category word (moduo-agent §Stages).
    if (!/unknown task status/i.test(String(err))) throw err;
    await rpc("tasks_set_status", { task_id: ref, status: STAGE_CATEGORY[status] });
  }
}

async function applyOne(move: Move, rpc: Rpc): Promise<Outcome> {
  // The search matches words anywhere (descriptions too), so take the widest page and filter.
  const rows = await rpc("tasks_search", { q: move.id, limit: 100 });
  const task = pickBlockTask(Array.isArray(rows) ? (rows as TaskRow[]) : [], move.id);
  if (task === "none") return { move, result: "no task" };
  if (task === "ambiguous") return { move, result: "ambiguous" };
  const ref = task.handle ?? task.id;
  // Done and won't do are people's calls (or already shipped): never reopen them from GitHub.
  if (CLOSED.has(task.status_category ?? "")) return { move, result: "closed", task: ref };
  await setStage(rpc, ref, move.status);
  if (move.comment)
    await rpc("comments_add", { entity_type: "task", entity_id: ref, body: move.comment });
  return { move, result: "moved", task: ref };
}

/** Applies each move: one tasks_set_status (plus its comment) per found, open task. */
export async function apply(moves: readonly Move[], rpc: Rpc): Promise<Outcome[]> {
  const out: Outcome[] = [];
  // One failing move (a task the key can't change) must not skip the rest of a release.
  for (const move of moves) {
    try {
      out.push(await applyOne(move, rpc));
    } catch (err) {
      out.push({ move, result: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** A JSON-RPC tools/call against the Moduo connector; the tool's JSON answer, or a thrown error. */
export function connectorRpc(url: string, key: string, fetchImpl: typeof fetch = fetch): Rpc {
  let next = 1;
  return async (tool, args) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: next++,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${tool}: HTTP ${res.status} ${raw.slice(0, 200)}`);
    // JSON by default; an event stream carries the same message on its data line.
    const body = raw.trimStart().startsWith("{")
      ? raw
      : raw
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
    const msg = JSON.parse(body) as {
      error?: { message?: string };
      result?: { isError?: boolean; content?: { type: string; text?: string }[] };
    };
    if (msg.error) throw new Error(`${tool}: ${msg.error.message ?? "error"}`);
    const text = msg.result?.content?.find((c) => c.type === "text")?.text ?? "null";
    if (msg.result?.isError) throw new Error(`${tool}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
}

// ── GitHub event → moves ─────────────────────────────────────────────────

export interface GitHubFacts {
  /** The repo's open PRs (asked only for a closed, unmerged block PR). */
  openPrs: () => Promise<{ number: number; title: string }[]>;
  /** `releaseLog` (release only). */
  log: (tag: string) => string;
  /** The release tags on a commit (release only, when the run doesn't name its tag). */
  tagsAt?: (sha: string) => string[];
}

function prFacts(event: Record<string, any>): PrFacts {
  const p = event.pull_request ?? {};
  const from = event.changes?.title?.from;
  return {
    action: String(event.action ?? ""),
    number: Number(p.number),
    title: String(p.title ?? ""),
    draft: Boolean(p.draft),
    merged: Boolean(p.merged),
    url: String(p.html_url ?? ""),
    previousTitle: typeof from === "string" ? from : undefined,
    state: typeof p.state === "string" ? p.state : undefined,
  };
}

async function planPrEvent(event: Record<string, any>, gh: GitHubFacts): Promise<Move[]> {
  const pr = prFacts(event);
  const needsOpen = pr.action === "closed" && !pr.merged && blockIdFromTitle(pr.title) !== null;
  // The closed PR itself may still be listed for a moment: leave it out.
  const open = needsOpen
    ? (await gh.openPrs()).filter((o) => o.number !== pr.number).map((o) => o.title)
    : [];
  const move = planPullRequest(pr, open);
  return move ? [move] : [];
}

/** The release tag a successful release run shipped, or "". */
function releaseTagOf(run: Record<string, any>, gh: GitHubFacts): string {
  if (run.conclusion !== "success" || run.event !== "push") return "";
  // A tag push's run names the tag as its head_branch; else find the tag on its commit.
  const named = String(run.head_branch ?? "");
  if (RELEASE_TAG.test(named)) return named;
  const sha = String(run.head_sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha)) return "";
  return (gh.tagsAt?.(sha) ?? []).find((t) => RELEASE_TAG.test(t)) ?? "";
}

/** The moves one GitHub event makes. Unknown events make none. */
export async function planEvent(
  name: string,
  event: Record<string, any>,
  gh: GitHubFacts,
): Promise<Move[]> {
  if (name === "pull_request" || name === "pull_request_target") return planPrEvent(event, gh);
  if (name === "workflow_run") {
    const tag = releaseTagOf(event.workflow_run ?? {}, gh);
    return tag ? planRelease(tag, blockIdsInLog(gh.log(tag))) : [];
  }
  if (name === "workflow_dispatch") {
    const tag = String(event.inputs?.tag ?? "");
    if (!RELEASE_TAG.test(tag))
      throw new Error(`workflow_dispatch needs a release tag, got "${tag}"`);
    return planRelease(tag, blockIdsInLog(gh.log(tag)));
  }
  return [];
}

async function githubOpenPrs(
  repo: string,
  token: string,
): Promise<{ number: number; title: string }[]> {
  const out: { number: number; title: string }[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=${page}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) throw new Error(`GitHub open PRs: HTTP ${res.status}`);
    const rows = (await res.json()) as { number: number; title: string }[];
    out.push(...rows.map((r) => ({ number: r.number, title: r.title })));
    if (rows.length < 100) break;
  }
  return out;
}

/** One log line per outcome; a missing, doubled or unreachable task is a warning on the run. */
export function outcomeLine(o: Outcome): string {
  const where = o.task ? ` ${o.task}` : "";
  const line = `${o.result}:${where} ${o.move.id} → ${o.move.status} (${o.move.reason})`;
  if (o.result === "moved" || o.result === "closed") return line;
  return `::warning::${line}${o.error ? ` · ${o.error}` : ""}`;
}

async function main(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const name = process.env.GITHUB_EVENT_NAME ?? "";
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not set");
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, any>;
  const moves = await planEvent(name, event, {
    openPrs: () =>
      githubOpenPrs(process.env.GITHUB_REPOSITORY ?? "", process.env.GITHUB_TOKEN ?? ""),
    log: (tag) => releaseLog(tag),
    tagsAt: (sha) =>
      execFileSync("git", ["tag", "--points-at", sha, "--list", "v*", "--sort=-v:refname"], {
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean),
  });
  // For the workflow's plan job: the apply job (the one with the key) runs only when there is a move.
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `moves=${moves.length}\n`);
  if (moves.length === 0) {
    console.log(`moduo-sync: ${name} makes no move.`);
    return;
  }
  for (const m of moves) console.log(`plan: ${m.id} → ${m.status} (${m.reason})`);
  if (dryRun) return;
  const key = process.env.MODUO_CI_KEY ?? "";
  if (!key) {
    // Not set up yet (or a run without the environment): say so, never fail the PR.
    console.log("::notice::moduo-sync: MODUO_CI_KEY is not set; nothing was moved.");
    return;
  }
  const rpc = connectorRpc(process.env.MODUO_MCP_URL || "https://mcp.moduo.app", key);
  const outcomes = await apply(moves, rpc);
  for (const o of outcomes) console.log(outcomeLine(o));
  if (outcomes.some((o) => o.result === "failed")) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`moduo-sync: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
