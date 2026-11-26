/**
 * How much context a session carried (the 2026-11-26 context diet): the tokens in its first
 * model call, at its first edit, and at its peak, read from Claude Code's local transcripts
 * (`~/.claude/projects/<project>/<session>.jsonl`). Only `usage` numbers, tool names and a
 * yes/no "is this call an edit" leave a transcript: no prompt, reply or tool output is kept.
 *
 * `bun run numbers` reports the weekly medians; `bun scripts/agent/context-stats.ts [days]`
 * prints them for the last N days (default 7) on this machine.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface SessionContext {
  /** ISO time of the session's first line that has one. */
  start: string;
  /** Model calls in the main thread. */
  calls: number;
  /** Input tokens (fresh, cache writes and cache reads) of the first model call. */
  entrance: number;
  /** The same, for the call that made the first edit; null when the session edited nothing. */
  atFirstEdit: number | null;
  /** Model calls up to and including the first edit. */
  callsToFirstEdit: number | null;
  /** The largest input of any call. */
  peak: number;
}

type Usage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
type Block = { type?: string; name?: string; input?: unknown };
type Line = {
  type?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: { id?: string; usage?: Usage; content?: unknown };
};

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** Code Mode edits through a script: `edit(…)` or `write(…)`. Scratch files and memory don't count. */
const SCRIPT_EDIT = /\bedit\(|[^.\w]write\(/;
const NOT_PROJECT = /scratchpad|SESSION_TITLE|\/memory\//;

const inputOf = (u: Usage) =>
  (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

function isEdit(block: Block): boolean {
  if (block.type !== "tool_use" || !block.name) return false;
  const input = JSON.stringify(block.input ?? {});
  if (NOT_PROJECT.test(input)) return false;
  return EDIT_TOOLS.has(block.name) || (block.name === "REPL" && SCRIPT_EDIT.test(input));
}

function parse(raw: string): Line | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Line;
  } catch {
    return null;
  }
}

type Message = NonNullable<Line["message"]>;

/** One model call is written as several lines (one per content block) that repeat its usage. */
function countCall(msg: Message, seen: Set<string>, calls: number[]): void {
  if (!msg.id || !msg.usage || seen.has(msg.id)) return;
  seen.add(msg.id);
  calls.push(inputOf(msg.usage));
}

const hasEdit = (msg: Message) =>
  Array.isArray(msg.content) && (msg.content as Block[]).some(isEdit);

type Scan = { start: string; calls: number[]; firstEdit: { tokens: number; calls: number } | null };

/** The main thread's model calls in order, and where the first edit fell. */
function scan(lines: Iterable<string>): Scan {
  const out: Scan = { start: "", calls: [], firstEdit: null };
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = parse(raw);
    if (!line || line.isSidechain) continue;
    out.start ||= line.timestamp ?? "";
    const msg = line.type === "assistant" ? line.message : undefined;
    if (!msg) continue;
    countCall(msg, seen, out.calls);
    if (!out.firstEdit && hasEdit(msg))
      out.firstEdit = { tokens: out.calls.at(-1) ?? 0, calls: out.calls.length };
  }
  return out;
}

/** One transcript's numbers; null for a session with fewer than three model calls (an aborted start). */
export function sessionContext(lines: Iterable<string>): SessionContext | null {
  const { start, calls, firstEdit } = scan(lines);
  if (calls.length < 3 || !start) return null;
  return {
    start,
    calls: calls.length,
    entrance: calls[0] ?? 0,
    atFirstEdit: firstEdit?.tokens ?? null,
    callsToFirstEdit: firstEdit?.calls ?? null,
    peak: Math.max(...calls),
  };
}

export interface ContextSummary {
  sessions: number;
  /** Medians over the sessions (first-edit figures over the sessions that edited). */
  entrance: number;
  atFirstEdit: number;
  callsToFirstEdit: number;
  peak: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
};

/** Medians of the sessions that started in [from, to); null when there are none. */
export function summarize(
  sessions: readonly SessionContext[],
  from: Date,
  to: Date,
): ContextSummary | null {
  const inside = sessions.filter((s) => {
    const t = Date.parse(s.start);
    return t >= from.getTime() && t < to.getTime();
  });
  if (inside.length === 0) return null;
  const nums = (pick: (s: SessionContext) => number | null) =>
    inside.map(pick).filter((n): n is number => n !== null);
  return {
    sessions: inside.length,
    entrance: median(nums((s) => s.entrance)),
    atFirstEdit: median(nums((s) => s.atFirstEdit)),
    callsToFirstEdit: median(nums((s) => s.callsToFirstEdit)),
    peak: median(nums((s) => s.peak)),
  };
}

/** Claude Code names a project's transcript folder after its path, every other character a dash. */
export const projectSlug = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, "-");

/**
 * Every main-thread session of this repository (its checkout and its worktrees) on this machine
 * whose transcript changed since `since`. An unreadable or missing folder gives an empty list.
 */
export function readSessions(
  repoRoot: string,
  since: Date,
  projectsDir = path.join(homedir(), ".claude/projects"),
): SessionContext[] {
  if (!existsSync(projectsDir)) return [];
  const slug = projectSlug(repoRoot);
  const out: SessionContext[] = [];
  for (const dir of readdirSync(projectsDir)) {
    // The checkout's own folder, or a worktree under it ("…/.claude/worktrees/x" → "…--claude-worktrees-x"):
    // a sibling such as moduo_latest_old shares the prefix and isn't this repository.
    if (dir !== slug && !dir.startsWith(`${slug}--`)) continue;
    out.push(...sessionsIn(path.join(projectsDir, dir), since));
  }
  return out;
}

/** One folder's sessions; a file that vanished or can't be read is skipped, not fatal. */
function sessionsIn(dir: string, since: Date): SessionContext[] {
  const out: SessionContext[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      if (statSync(file).mtimeMs < since.getTime()) continue;
      const s = sessionContext(readFileSync(file, "utf8").split("\n"));
      if (s) out.push(s);
    } catch {
      // Claude Code may be rotating it.
    }
  }
  return out;
}

if (import.meta.main) {
  const days = Number(process.argv[2] ?? 7);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const git = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const root = path.dirname(git.stdout.toString().trim());
  const s = summarize(readSessions(root, from), from, to);
  console.log(
    s
      ? `Last ${days} days, ${s.sessions} sessions (medians): start ${s.entrance} · first edit ${s.atFirstEdit} after ${s.callsToFirstEdit} calls · peak ${s.peak} tokens`
      : `No sessions of this repository in the last ${days} days on this machine.`,
  );
}
