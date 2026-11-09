// The block queue (Harness v3, HV-8, specs/harness-v3.md AC12): Moduo holds
// each block's state, owner and order; the specs' Execution blocks tables hold
// its dependencies; open PRs are the claims. `bun run queue` joins the three.
//
//   ready    open in Moduo (to do), no open "[ID]" PR, every dependency merged or closed
//   claimed  an open "[ID]" PR, or the task is in progress
//   waiting  a dependency not merged yet (spec table or a Moduo "blocks" edge), or Backlog
//
//   bun run queue           prints the Focus, then ready, claimed and waiting blocks
//   bun run queue next      prints the first ready block's ID (what `/s2 next` builds)
//   bun run queue --json    the same lists as JSON
//
// A block task is a task tagged `block` whose title starts with "<ID> — " or
// ends with "(<ID>)" (moduo-sync.ts, the moduo-agent skill). Ready blocks keep
// Moduo's order: Closed alpha, Open alpha, Beta & later, then the rest, each
// by its position in the project. Without Moduo (no MODUO_MCP_KEY, the
// connector down) the queue falls back to the spec tables and PR state and
// says so. New blocks reach Moduo through `bun run queue:import`
// (queue-import.ts). Env: MODUO_MCP_KEY (your agent's key, the one .mcp.json
// sends), MODUO_MCP_URL (default https://mcp.moduo.app).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { blockIdFromTitle, connectorRpc, type Rpc } from "./moduo-sync";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The milestone projects, in the order their blocks are built. */
export const MILESTONES = ["Closed alpha", "Open alpha", "Beta & later"];
export const FOCUS_NOTE_TITLE = "Focus";
/** The stage a merged, unreleased block sits in (moduo-sync.ts). */
export const MERGED_STAGE = "Awaiting release";

const ID_SRC = "[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+";
const ID_ANY = new RegExp(`\\b${ID_SRC}\\b`, "g");

export interface SpecBlock {
  id: string;
  name: string;
  /** Repo path of the spec the block comes from. */
  spec: string;
  deps: string[];
  /** Marked ✅ in the table. */
  done: boolean;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const plain = (s: string) => s.replace(/\*\*|`/g, "").trim();

/** The rows of a spec's "## Execution blocks" table that carry a block ID. */
/** The table rows of a spec's "## Execution blocks" section (header first). */
function blockTableRows(md: string): string[] {
  const start = md.search(/^## Execution blocks/m);
  if (start < 0) return [];
  const rest = md.slice(start).split("\n").slice(1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim().startsWith("|"));
}

/** A row's block ID (first cell, else in the second) and its name. */
function rowIdentity(first: string, second: string): { id: string; name: string } | null {
  const inFirst = plain(first).match(new RegExp(`^${ID_SRC}`));
  const id = inFirst?.[0] ?? plain(second).match(new RegExp(ID_SRC))?.[0];
  if (!id) return null;
  const name = plain(inFirst ? second : second.replace(id, ""))
    .replace(/\*\([^)]*\)\*/g, "")
    .replace(/✅.*$/, "")
    .replace(/^[\s—·:-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return { id, name };
}

/** The rows of a spec's "## Execution blocks" table that carry a block ID. */
export function parseExecutionBlocks(md: string, spec: string): SpecBlock[] {
  const rows = blockTableRows(md);
  const hasDeps = /depend/i.test((rows[0] ? cells(rows[0]) : []).at(-1) ?? "");
  const out: SpecBlock[] = [];
  const numbered = new Map<string, string>();
  const rawDeps: string[] = [];
  for (const row of rows.slice(1)) {
    const c = cells(row);
    const [first = "", second = ""] = c;
    const who = rowIdentity(first, second);
    if (!who) continue;
    if (/^\d+[a-z]?$/.test(plain(first))) numbered.set(plain(first), who.id);
    rawDeps.push(hasDeps && c.length > 2 ? c.at(-1)! : "");
    out.push({ ...who, spec, deps: [], done: /✅/.test(first + second) });
  }
  out.forEach((b, i) => (b.deps = depsOf(rawDeps[i]!, b.id, numbered, out)));
  return out;
}

/**
 * The block IDs a "Depends on" cell names. A cell made only of short row refs
 * ("7, 0b") names rows of the same table: by the "#" column, else by the ID
 * with that suffix (MEET-0b). Prose numbers ("≥2 desktop releases") don't count.
 */
function depsOf(
  cell: string,
  self: string,
  numbered: ReadonlyMap<string, string>,
  rows: readonly SpecBlock[],
): string[] {
  const ids = new Set(plain(cell).match(ID_ANY) ?? []);
  const rest = plain(cell).replace(ID_ANY, "");
  // Each ref must end at a separator or the end, so a run of digits splits only one way.
  if (/^[\s,+&—–-]*(?:(?:\d+[a-z]?|and)(?:[\s,+&—–-]+|$))+$/.test(rest)) {
    const prefix = self.split("-")[0];
    for (const ref of rest.match(/\b\d+[a-z]?\b/g) ?? []) {
      const hit = numbered.get(ref) ?? rows.find((r) => r.id === `${prefix}-${ref}`)?.id;
      if (hit) ids.add(hit);
    }
  }
  ids.delete(self);
  return [...ids];
}

/**
 * Every spec's Execution blocks, keyed by ID. An ID in two specs (a re-plan)
 * takes the row that names more dependencies, else the later file.
 */
export function readSpecBlocks(root = ROOT): Map<string, SpecBlock> {
  const map = new Map<string, SpecBlock>();
  const dir = path.join(root, "specs");
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".md") || f.startsWith("_")) continue;
    for (const b of parseExecutionBlocks(readFileSync(path.join(dir, f), "utf8"), `specs/${f}`))
      if ((map.get(b.id)?.deps.length ?? -1) <= b.deps.length) map.set(b.id, b);
  }
  return map;
}

// ── Moduo ────────────────────────────────────────────────────────────────

export interface TaskRow {
  handle: string;
  id: string;
  title: string;
  /** The category word: backlog · todo · in_progress · done · wont_do. */
  status: string;
  status_name?: string;
  assignee?: string;
  section?: string;
  tags?: string[];
  blocked?: boolean;
}

export interface BlockTask extends TaskRow {
  blockId: string;
  project: string;
}

const TITLE_ID = new RegExp(`^(${ID_SRC}) — |\\((${ID_SRC})\\)$`);

/** The block ID a block task's title carries, or null. */
export function blockIdOfTask(title: string): string | null {
  const m = TITLE_ID.exec(title.trim());
  return m ? (m[1] ?? m[2] ?? null) : null;
}

const asRows = (v: unknown): TaskRow[] =>
  (Array.isArray(v) ? v : ((v as { tasks?: unknown[] })?.tasks ?? [])) as TaskRow[];

/** Every live block task (open and backlog) the key sees, milestones first, then by project position. */
export async function fetchBlockTasks(rpc: Rpc): Promise<BlockTask[]> {
  // A list that spans projects names each row's project; two categories, paged.
  const lists = await Promise.all(
    ["open", "backlog"].map(async (category) => {
      const all: (TaskRow & { project?: string })[] = [];
      for (let offset = 0; ; offset += 200) {
        const rows = asRows(await rpc("tasks_list", { category, limit: 200, offset }));
        all.push(...rows);
        if (rows.length < 200) return all;
      }
    }),
  );
  const rank = (n: string) => {
    const i = MILESTONES.indexOf(n);
    return i < 0 ? MILESTONES.length : i;
  };
  const out: BlockTask[] = [];
  for (const r of lists.flat()) {
    const blockId = blockIdOfTask(r.title);
    if (blockId && r.tags?.includes("block")) out.push({ ...r, blockId, project: r.project ?? "" });
  }
  // Stable: within a milestone, the list's own order (project, then position).
  return out.sort((x, y) => rank(x.project) - rank(y.project));
}

/** The block IDs blocking each flagged task, read from its "blocks" edges. */
export async function fetchBlockers(
  rpc: Rpc,
  tasks: readonly BlockTask[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const flagged = tasks.filter((t) => t.blocked);
  for (let i = 0; i < flagged.length; i += 4) {
    await Promise.all(
      flagged.slice(i, i + 4).map(async (t) => {
        const got = (await rpc("tasks_get", { task_id: t.handle })) as {
          blockers?: { title: string }[];
        };
        const ids = (got.blockers ?? [])
          .map((b) => blockIdOfTask(b.title))
          .filter((x) => x !== null);
        out.set(t.handle, ids);
      }),
    );
  }
  return out;
}

interface NoteRow {
  id: string;
  title: string;
}

/** The Focus note's body (the designer's current focus area), or null when there is none. */
export async function fetchFocus(rpc: Rpc): Promise<string | null> {
  const notes = (await rpc("notes_list", { limit: 200 })) as NoteRow[] | { notes?: NoteRow[] };
  const list = Array.isArray(notes) ? notes : (notes.notes ?? []);
  const note = list.find((n) => n.title.trim() === FOCUS_NOTE_TITLE);
  if (!note) return null;
  const got = (await rpc("notes_get", { note_id: note.id })) as {
    markdown?: string;
    body_md?: string;
  };
  // The body starts with the title as its first line; markdown escapes stray asterisks.
  const body = (got.markdown ?? got.body_md ?? "")
    .replace(new RegExp(`^\\s*#*\\s*${FOCUS_NOTE_TITLE}\\s*\\n`), "")
    .replace(/\\([*_])/g, "$1")
    .trim();
  return body || null;
}

// ── GitHub ───────────────────────────────────────────────────────────────

export interface Pr {
  number: number;
  title: string;
  isDraft?: boolean;
  url?: string;
}

/** The repo's open PRs (gh). */
export function openPrs(): Pr[] {
  const out = execFileSync(
    "gh",
    ["pr", "list", "--state", "open", "--limit", "300", "--json", "number,title,isDraft,url"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 },
  );
  return JSON.parse(out) as Pr[];
}

/** Every block-like ID a commit message on HEAD mentions (the fallback's "done"). */
export function idsInHistory(cwd = ROOT): Set<string> {
  const log = execFileSync("git", ["log", "HEAD", "--format=%s%n%b"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return new Set(log.match(ID_ANY) ?? []);
}

// ── The join ─────────────────────────────────────────────────────────────

export interface QueueEntry {
  id: string;
  name: string;
  task?: string;
  project?: string;
  section?: string;
  assignee?: string;
  spec?: string;
  pr?: Pr;
  /** For waiting blocks: the open dependencies, or "backlog" / "blocked in Moduo". */
  waitingOn?: string[];
}

export interface Queue {
  source: "moduo" | "specs";
  ready: QueueEntry[];
  claimed: QueueEntry[];
  waiting: QueueEntry[];
}

interface Candidate {
  entry: QueueEntry;
  status: "backlog" | "todo" | "in_progress";
  /** Merged, waiting for a release: open in Moduo, but its dependents can start. */
  merged?: boolean;
  /** The block IDs of its Moduo blockers ("blocks" edges). */
  blockers?: string[];
}

function prsById(openPrs: readonly Pr[]): Map<string, Pr> {
  const out = new Map<string, Pr>();
  for (const pr of openPrs) {
    const id = blockIdFromTitle(pr.title);
    if (id && !out.has(id)) out.set(id, pr);
  }
  return out;
}

/** What a block still waits on: dependencies not merged yet, and Backlog. */
function waitingOn(c: Candidate, specs: ReadonlyMap<string, SpecBlock>, unmerged: Set<string>) {
  const all = new Set([...(specs.get(c.entry.id)?.deps ?? []), ...(c.blockers ?? [])]);
  const deps = [...all].filter((d) => d !== c.entry.id && unmerged.has(d));
  return [...deps, ...(c.status === "backlog" ? ["backlog"] : [])];
}

function classify(
  candidates: readonly Candidate[],
  specs: ReadonlyMap<string, SpecBlock>,
  openPrs: readonly Pr[],
  source: Queue["source"],
): Queue {
  // A dependency holds a block back until it is merged (the rule: merged into the personal branch).
  const unmerged = new Set(candidates.filter((c) => !c.merged).map((c) => c.entry.id));
  const prOf = prsById(openPrs);
  const q: Queue = { source, ready: [], claimed: [], waiting: [] };
  for (const c of candidates) {
    const pr = prOf.get(c.entry.id);
    const entry = { ...c.entry, ...(pr ? { pr } : {}) };
    const waits = waitingOn(c, specs, unmerged);
    if (pr || c.status === "in_progress") q.claimed.push(entry);
    else if (waits.length) q.waiting.push({ ...entry, waitingOn: waits });
    else q.ready.push(entry);
  }
  return q;
}

/** The queue from Moduo's block tasks, the spec tables and the open PRs. */
export function queueFromModuo(
  tasks: readonly BlockTask[],
  specs: ReadonlyMap<string, SpecBlock>,
  openPrs: readonly Pr[],
  /** Block IDs of each blocked task's Moduo blockers, by handle. */
  blockers: ReadonlyMap<string, string[]> = new Map(),
): Queue {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const t of tasks) {
    if (seen.has(t.blockId)) continue; // a duplicate task: the first (milestone order) counts
    if (!["backlog", "todo", "in_progress"].includes(t.status)) continue;
    seen.add(t.blockId);
    const name = t.title.replace(TITLE_ID, "").trim();
    candidates.push({
      status: t.status as Candidate["status"],
      merged: t.status_name === MERGED_STAGE,
      blockers: blockers.get(t.handle),
      entry: {
        id: t.blockId,
        name,
        task: t.handle,
        project: t.project,
        section: t.section,
        assignee: t.assignee,
        spec: specs.get(t.blockId)?.spec,
      },
    });
  }
  return classify(candidates, specs, openPrs, "moduo");
}

/**
 * Moduo unreachable: a spec block is open unless it is marked ✅ or a commit
 * message on HEAD mentions its ID (approximate: a block named before it was
 * built shows as done).
 */
export function queueFromSpecs(
  specs: ReadonlyMap<string, SpecBlock>,
  openPrs: readonly Pr[],
  history: ReadonlySet<string>,
): Queue {
  const claimed = new Set(openPrs.map((p) => blockIdFromTitle(p.title)));
  const candidates: Candidate[] = [];
  for (const b of specs.values()) {
    if (b.done || (history.has(b.id) && !claimed.has(b.id))) continue;
    candidates.push({ status: "todo", entry: { id: b.id, name: b.name, spec: b.spec } });
  }
  return classify(candidates, specs, openPrs, "specs");
}

// ── Output ───────────────────────────────────────────────────────────────

function line(e: QueueEntry): string {
  const where = [e.task, e.project && [e.project, e.section].filter(Boolean).join(" · ")]
    .filter(Boolean)
    .join(" · ");
  const pr = e.pr ? ` · PR #${e.pr.number}${e.pr.isDraft ? " (draft)" : ""}` : "";
  const who = e.assignee && e.assignee !== "Unassigned" ? ` · ${e.assignee}` : "";
  const wait = e.waitingOn ? ` · waits on ${e.waitingOn.join(", ")}` : "";
  return `  ${e.id.padEnd(9)} ${e.name}${where ? `  (${where})` : e.spec ? `  (${e.spec})` : ""}${pr}${who}${wait}`;
}

export function render(q: Queue, focus: string | null, notice?: string): string {
  const out: string[] = [];
  if (notice) out.push(notice, "");
  if (focus) out.push(`Focus: ${focus.split("\n")[0]}`, "");
  for (const [label, list] of [
    ["Ready", q.ready],
    ["Claimed", q.claimed],
    ["Waiting", q.waiting],
  ] as const) {
    out.push(`${label} (${list.length})`);
    out.push(...(list.length ? list.map(line) : ["  —"]));
    out.push("");
  }
  return out.join("\n").trimEnd();
}

export interface Sources {
  rpc: Rpc | null;
  specs: () => Map<string, SpecBlock>;
  prs: () => Pr[];
  history: () => Set<string>;
}

/** The queue and its Focus, falling back to the specs when Moduo can't be read. */
export async function buildQueue(
  src: Sources,
): Promise<{ queue: Queue; focus: string | null; notice?: string }> {
  const specs = src.specs();
  let open: Pr[] = [];
  let prNotice = "";
  try {
    open = src.prs();
  } catch {
    prNotice = " Open PRs unavailable (gh), so no block shows as claimed by a PR.";
  }
  if (src.rpc) {
    try {
      const tasks = await fetchBlockTasks(src.rpc);
      const [blockers, focus] = await Promise.all([
        fetchBlockers(src.rpc, tasks),
        fetchFocus(src.rpc).catch(() => null),
      ]);
      return {
        queue: queueFromModuo(tasks, specs, open, blockers),
        focus,
        ...(prNotice ? { notice: prNotice.trim() } : {}),
      };
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 120) : String(err);
      return fallback(src, specs, open, `Moduo unreachable (${why}).${prNotice}`);
    }
  }
  return fallback(src, specs, open, `Moduo unreachable (MODUO_MCP_KEY is not set).${prNotice}`);
}

function fallback(src: Sources, specs: Map<string, SpecBlock>, open: Pr[], why: string) {
  let history = new Set<string>();
  try {
    history = src.history();
  } catch {
    // Without git history, only ✅ rows count as done.
  }
  return {
    queue: queueFromSpecs(specs, open, history),
    focus: null,
    notice: `${why} Falling back to the spec tables, open PRs and git history: a block no commit names shows as open, in spec order.`,
  };
}

export function moduoRpcFromEnv(): Rpc | null {
  const key = process.env.MODUO_MCP_KEY ?? "";
  return key ? connectorRpc(process.env.MODUO_MCP_URL || "https://mcp.moduo.app", key) : null;
}

async function main(argv: string[]): Promise<void> {
  const { queue, focus, notice } = await buildQueue({
    rpc: moduoRpcFromEnv(),
    specs: () => readSpecBlocks(),
    prs: openPrs,
    history: () => idsInHistory(),
  });
  if (argv[0] === "next") {
    if (notice) console.error(notice);
    const first = queue.ready[0];
    if (!first) {
      console.error("No ready block.");
      process.exit(1);
    }
    console.log(first.id);
    return;
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...queue, focus, notice: notice ?? null }, null, 2));
    return;
  }
  console.log(render(queue, focus, notice));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`queue: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
