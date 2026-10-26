// Blocks into Moduo (Harness v3, HV-8, specs/harness-v3.md AC12): each open
// block of a spec's Execution blocks table becomes a Moduo task, and each
// dependency a "blocks" edge between the two tasks. Idempotent: a re-run
// updates and never duplicates.
//
//   bun run queue:import specs/<feature>.md …   the spec's blocks (/s1 runs this)
//   bun run queue:import --ledger <file>         the open rows of a pre-HV-8
//                                                specs/BUILD_ORDER.md (the migration)
//   bun run queue:import --focus "<text>"        writes the Focus note
//   --dry-run                                    prints the plan, writes nothing
//
// A block's task is found by its ID in the title (moduo-sync.ts's rule). Found
// and open: it gets the `block` tag, a spec link at the top of its description
// and a section when it has none; its title, status, project and assignee stay
// as people left them. Found and closed (Shipped, Won't do): left alone, never
// reopened. Not found: created as "<ID> — <name>", To do (Backlog for a paused
// ⏸ ledger row), unassigned, tagged `block`, in the project and section of its
// siblings (blocks with the same ID prefix), else in Beta & later; a spec block
// a commit on HEAD already names is taken as built and not created. Then every
// dependency whose task is open gets a "blocks" edge (links_create is
// idempotent). Writes go through the moduo connector with your agent's key
// (MODUO_MCP_KEY), never the service role.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { blockIdFromTitle, type Rpc } from "./moduo-sync";
import {
  FOCUS_NOTE_TITLE,
  idsInHistory,
  moduoRpcFromEnv,
  openPrs as listOpenPrs,
  parseExecutionBlocks,
  readSpecBlocks,
  type SpecBlock,
} from "./queue";

export const SPEC_URL = "https://github.com/GrochowskiMichal/Moduo/blob/develop/";
const IMPORT_SOURCE = "moduo-spec";
const FALLBACK_PROJECT = "Beta & later";

export interface ImportBlock {
  id: string;
  name: string;
  spec?: string;
  deps: string[];
  /** A ⏸ ledger row: created in Backlog. */
  paused?: boolean;
  /** From a spec table (not the ledger): skip creating it when history names it. */
  fromSpec?: boolean;
}

// ── The migration input: the old ledger ──────────────────────────────────

const LEDGER_ROW = /^- \[( |~)\] (.*)$/;
const LEDGER_ID = /\*\*([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+) — ([^*]+)\*\*/;
const ID_ANY = /\b[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+\b/g;

/** The open (`[ ]` and `[~]`) rows of a pre-HV-8 BUILD_ORDER.md, with their section's spec. */
export function parseLedger(md: string): ImportBlock[] {
  const out: ImportBlock[] = [];
  let spec: string | undefined;
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      const link = /\]\(\.\/([\w./-]+\.md)\)/.exec(line)?.[1];
      spec = link && !link.startsWith("..") ? `specs/${link}` : undefined;
      continue;
    }
    const row = LEDGER_ROW.exec(line);
    const m = row && LEDGER_ID.exec(row[2]!);
    if (!m) continue;
    const deps = /· deps: ([^·]*)/.exec(row![2]!)?.[1] ?? "";
    out.push({
      id: m[1]!,
      name: m[2]!.trim(),
      spec,
      deps: [...new Set(deps.replace(/~~[^~]*~~/g, "").match(ID_ANY) ?? [])].filter(
        (d) => d !== m[1],
      ),
      paused: row![2]!.includes("⏸"),
    });
  }
  return out;
}

// ── Moduo state ──────────────────────────────────────────────────────────

export interface FoundTask {
  handle: string;
  title: string;
  status_category: string;
  bucket_id?: string;
  section_id?: string | null;
  tags?: string[];
  description?: string;
  project_archived?: boolean;
}

export type Lookup = FoundTask | "none" | "ambiguous";

const CLOSED = new Set(["done", "wont_do"]);

/** The live task whose title carries the block ID (starts "<ID> — " or ends "(<ID>)"). */
export function findBlockTask(rows: readonly FoundTask[], id: string): Lookup {
  const hits = rows.filter((r) => {
    if (r.project_archived) return false;
    const t = r.title.trim();
    return t.startsWith(`${id} — `) || t.endsWith(`(${id})`);
  });
  if (hits.length === 0) return "none";
  if (hits.length > 1) {
    // A done duplicate beside one open task: the open one is the block's.
    const open = hits.filter((h) => !CLOSED.has(h.status_category));
    return open.length === 1 ? open[0]! : "ambiguous";
  }
  return hits[0]!;
}

const prefixOf = (id: string) => id.split("-")[0]!;

export const specLine = (spec: string) => `Spec: [${spec}](${SPEC_URL}${spec})`;

// ── The plan (pure) ──────────────────────────────────────────────────────

export interface Placement {
  project_id: string;
  section_id?: string;
}

export type Step =
  | { kind: "create"; block: ImportBlock; placement: Placement; status: string }
  | { kind: "update"; block: ImportBlock; task: string; changes: Record<string, unknown> }
  | { kind: "keep"; block: ImportBlock; task: string }
  | { kind: "skip"; block: ImportBlock; why: string; task?: string }
  | { kind: "edge"; from: string; to: string };

/** Where siblings of each ID prefix live: the most common project + section among found tasks. */
export function siblingPlacements(found: ReadonlyMap<string, Lookup>): Map<string, Placement> {
  const counts = new Map<string, Map<string, number>>();
  for (const [id, t] of found) {
    if (typeof t === "string" || !t.bucket_id) continue;
    const key = JSON.stringify([t.bucket_id, t.section_id ?? null]);
    const m = counts.get(prefixOf(id)) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + 1);
    counts.set(prefixOf(id), m);
  }
  const out = new Map<string, Placement>();
  for (const [prefix, m] of counts) {
    const [best] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const [project_id, section_id] = JSON.parse(best) as [string, string | null];
    out.set(prefix, { project_id, ...(section_id ? { section_id } : {}) });
  }
  return out;
}

export interface PlanInput {
  blocks: readonly ImportBlock[];
  /** The lookup of every block ID and every dependency ID. */
  found: ReadonlyMap<string, Lookup>;
  /** IDs a commit on HEAD names. */
  history: ReadonlySet<string>;
  fallbackProject: string;
  /** Open PRs by block ID ("[ID] …" titles): a new task starts in the stage the sync would have set. */
  openPrs?: ReadonlyMap<string, { draft: boolean }>;
  /** Full descriptions of found open tasks (search rows carry an excerpt). */
  descriptions: ReadonlyMap<string, string>;
}

const isOpenTask = (t: Lookup | undefined): t is FoundTask =>
  t !== undefined && typeof t !== "string" && !CLOSED.has(t.status_category);

function createStatus(block: ImportBlock, pr: { draft: boolean } | undefined): string {
  if (pr) return pr.draft ? "Building" : "In review";
  return block.paused ? "backlog" : "todo";
}

/** What a found open task lacks: the tag, the spec link on top, a section. */
function missingOn(t: FoundTask, block: ImportBlock, input: PlanInput, sib?: Placement) {
  const changes: Record<string, unknown> = {};
  if (!t.tags?.includes("block")) changes.tags_add = ["block"];
  const desc = (input.descriptions.get(t.handle) ?? t.description ?? "").trim();
  if (block.spec && !desc.includes(block.spec))
    changes.description = desc ? `${specLine(block.spec)}\n\n${desc}` : specLine(block.spec);
  if (!t.section_id && sib?.section_id && sib.project_id === t.bucket_id)
    changes.section_id = sib.section_id;
  return changes;
}

function planBlock(block: ImportBlock, input: PlanInput, places: Map<string, Placement>): Step {
  const t = input.found.get(block.id) ?? "none";
  const sib = places.get(prefixOf(block.id));
  if (t === "ambiguous") return { kind: "skip", block, why: "two open tasks carry this ID" };
  if (t === "none") {
    if (block.fromSpec && input.history.has(block.id))
      return { kind: "skip", block, why: "a commit already names it (built)" };
    const placement = sib ?? { project_id: input.fallbackProject };
    return {
      kind: "create",
      block,
      placement,
      status: createStatus(block, input.openPrs?.get(block.id)),
    };
  }
  if (CLOSED.has(t.status_category))
    return { kind: "skip", block, why: "closed in Moduo", task: t.handle };
  const changes = missingOn(t, block, input, sib);
  return Object.keys(changes).length
    ? { kind: "update", block, task: t.handle, changes }
    : { kind: "keep", block, task: t.handle };
}

export function planImport(input: PlanInput): Step[] {
  const places = siblingPlacements(input.found);
  const steps = input.blocks.map((b) => planBlock(b, input, places));
  const willBeOpen = new Set(
    steps.flatMap((s) =>
      s.kind === "create" || s.kind === "update" || s.kind === "keep" ? [s.block.id] : [],
    ),
  );
  // Edges: every dependency that is (or becomes) an open block task.
  for (const block of input.blocks) {
    if (!willBeOpen.has(block.id)) continue;
    for (const dep of block.deps) {
      const open = willBeOpen.has(dep) || isOpenTask(input.found.get(dep));
      if (open && dep !== block.id) steps.push({ kind: "edge", from: dep, to: block.id });
    }
  }
  return steps;
}

// ── Applying it ──────────────────────────────────────────────────────────

// Reads, and links_create (idempotent on the server): safe to send twice.
const RETRYABLE = new Set([
  "tasks_search",
  "tasks_get",
  "projects_list",
  "notes_list",
  "links_create",
]);

/** Retries a read or an edge that timed out (the connector is slow under a burst), twice. */
export function retryingReads(rpc: Rpc): Rpc {
  return async (tool, args) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await rpc(tool, args);
      } catch (err) {
        if (!RETRYABLE.has(tool) || attempt >= 2 || !/timed out|timeout/i.test(String(err)))
          throw err;
      }
    }
  };
}

/** Looks every ID up by search (substring over title and description, so filtered here). */
export async function lookUp(rpc: Rpc, ids: readonly string[]): Promise<Map<string, Lookup>> {
  const out = new Map<string, Lookup>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 4) {
    const batch = uniq.slice(i, i + 4);
    const rows = await Promise.all(batch.map((q) => rpc("tasks_search", { q, limit: 100 })));
    batch.forEach((id, j) => {
      const list = Array.isArray(rows[j]) ? (rows[j] as FoundTask[]) : [];
      out.set(id, findBlockTask(list, id));
    });
  }
  return out;
}

export function describe(block: ImportBlock): string {
  return block.spec
    ? `${specLine(block.spec)}\n\nBlock ${block.id} of the spec.`
    : `Block ${block.id}.`;
}

interface Run {
  rpc: Rpc;
  handles: Map<string, string>;
  importId?: string;
  log: (line: string) => void;
}

async function create(run: Run, s: Extract<Step, { kind: "create" }>): Promise<void> {
  if (!run.importId) {
    const begun = (await run.rpc("imports_begin", {
      source: IMPORT_SOURCE,
      label: "Blocks from the specs",
    })) as { id?: string; import_id?: string };
    run.importId = begun.import_id ?? begun.id;
  }
  const t = (await run.rpc("tasks_create", {
    title: `${s.block.id} — ${s.block.name}`,
    project_id: s.placement.project_id,
    ...(s.placement.section_id ? { section_id: s.placement.section_id } : {}),
    status: s.status,
    assignee_id: null,
    tags: ["block"],
    description: describe(s.block),
    imported_from: { source: IMPORT_SOURCE, key: s.block.id },
    ...(run.importId ? { import_id: run.importId } : {}),
  })) as { handle: string };
  run.handles.set(s.block.id, t.handle);
  run.log(`created ${t.handle} ${s.block.id} — ${s.block.name}`);
}

/** Links one dependency; false when either task is missing (nothing to link). */
async function edge(run: Run, s: Extract<Step, { kind: "edge" }>): Promise<boolean> {
  const from = run.handles.get(s.from);
  const to = run.handles.get(s.to);
  if (!from || !to) return false;
  await run.rpc("links_create", {
    source_type: "task",
    source_id: from,
    target_type: "task",
    target_id: to,
    relation_kind: "blocks",
  });
  run.log(`edge ${s.from} (${from}) blocks ${s.to} (${to})`);
  return true;
}

type Tally = { created: number; updated: number; edges: number; failed: number };

async function applyStep(run: Run, s: Step, tally: Tally): Promise<void> {
  if (s.kind === "create") {
    await create(run, s);
    tally.created++;
  } else if (s.kind === "update") {
    await run.rpc("tasks_update", { task_id: s.task, ...s.changes });
    tally.updated++;
    run.log(`updated ${s.task} ${s.block.id} (${Object.keys(s.changes).join(", ")})`);
  } else if (s.kind === "edge") {
    if (await edge(run, s)) tally.edges++;
  } else if (s.kind === "skip") {
    run.log(`skipped ${s.block.id}${s.task ? ` ${s.task}` : ""}: ${s.why}`);
  }
}

const stepName = (s: Step) => `${s.kind} ${"block" in s ? s.block.id : `${s.from}→${s.to}`}`;

export async function applyPlan(
  rpc: Rpc,
  steps: readonly Step[],
  found: ReadonlyMap<string, Lookup>,
  log: (line: string) => void,
): Promise<Tally> {
  const handles = new Map<string, string>();
  for (const [id, t] of found) if (typeof t !== "string") handles.set(id, t.handle);
  const run: Run = { rpc, handles, log };
  const tally: Tally = { created: 0, updated: 0, edges: 0, failed: 0 };
  for (const s of steps) {
    try {
      await applyStep(run, s, tally);
    } catch (err) {
      tally.failed++;
      log(`failed ${stepName(s)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (run.importId) await rpc("imports_finish", { import_id: run.importId }).catch(() => undefined);
  return tally;
}

/** Writes the Focus note, found by its title (the connector can't link a note to a project). */
export async function writeFocus(rpc: Rpc, text: string): Promise<string> {
  const notes = (await rpc("notes_list", { limit: 200 })) as { id: string; title: string }[];
  const note = (Array.isArray(notes) ? notes : []).find((n) => n.title.trim() === FOCUS_NOTE_TITLE);
  let id = note?.id;
  if (id) await rpc("notes_update", { note_id: id, markdown: text });
  else
    id = (
      (await rpc("notes_create", { title: FOCUS_NOTE_TITLE, markdown: text })) as { id: string }
    ).id;
  return id;
}

// ── CLI ──────────────────────────────────────────────────────────────────

function blocksFrom(argv: string[]): ImportBlock[] {
  const specs = readSpecBlocks();
  const ledgerAt = argv.indexOf("--ledger");
  const out: ImportBlock[] = [];
  if (ledgerAt >= 0) {
    for (const b of parseLedger(readFileSync(argv[ledgerAt + 1]!, "utf8"))) {
      const s = specs.get(b.id);
      out.push({
        ...b,
        spec: b.spec ?? s?.spec,
        deps: [...new Set([...b.deps, ...(s?.deps ?? [])])],
      });
    }
  }
  const files = argv.filter((a, i) => a.endsWith(".md") && argv[i - 1] !== "--ledger");
  for (const f of files) {
    const rel = f.replace(/^\.\//, "");
    for (const b of parseExecutionBlocks(readFileSync(f, "utf8"), rel) as SpecBlock[]) {
      if (b.done || out.some((o) => o.id === b.id)) continue;
      out.push({ id: b.id, name: b.name, spec: rel, deps: b.deps, fromSpec: true });
    }
  }
  return out;
}

/** Search rows carry a description excerpt: read the full one where the spec link may be missing. */
async function fullDescriptions(
  rpc: Rpc,
  blocks: readonly ImportBlock[],
  found: ReadonlyMap<string, Lookup>,
): Promise<Map<string, string>> {
  const toRead = blocks.flatMap((b) => {
    const t = found.get(b.id);
    if (!isOpenTask(t) || !b.spec || (t.description ?? "").includes(b.spec)) return [];
    return [t.handle];
  });
  const out = new Map<string, string>();
  for (let i = 0; i < toRead.length; i += 4) {
    await Promise.all(
      toRead.slice(i, i + 4).map(async (handle) => {
        const full = (await rpc("tasks_get", { task_id: handle })) as { description?: string };
        out.set(handle, full.description ?? "");
      }),
    );
  }
  return out;
}

function openPrsById(): Map<string, { draft: boolean }> {
  const out = new Map<string, { draft: boolean }>();
  try {
    for (const pr of listOpenPrs()) {
      const id = blockIdFromTitle(pr.title);
      if (id && !out.has(id)) out.set(id, { draft: Boolean(pr.isDraft) });
    }
  } catch {
    // Without gh, new tasks start in To do; the sync moves them on the next PR event.
  }
  return out;
}

function planLine(s: Step): string {
  if (s.kind === "edge") return `edge   ${s.from} blocks ${s.to}`;
  if (s.kind === "create") return `create ${s.block.id} — ${s.block.name} (${s.status})`;
  if (s.kind === "update")
    return `update ${s.task} ${s.block.id}: ${Object.keys(s.changes).join(", ")}`;
  if (s.kind === "keep") return `keep   ${s.task} ${s.block.id}`;
  return `skip   ${s.block.id}: ${s.why}`;
}

async function focus(rpc: Rpc, text: string, dryRun: boolean): Promise<void> {
  if (!text.trim()) throw new Error("--focus needs the text");
  if (dryRun) console.log(`would write the Focus note: ${text}`);
  else console.log(`Focus note ${await writeFocus(rpc, text)}`);
}

async function main(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const env = moduoRpcFromEnv();
  if (!env)
    throw new Error("MODUO_MCP_KEY is not set: the import writes through your agent's key.");
  const rpc = retryingReads(env);
  const focusAt = argv.indexOf("--focus");
  if (focusAt >= 0) return focus(rpc, argv[focusAt + 1] ?? "", dryRun);
  const blocks = blocksFrom(argv);
  if (blocks.length === 0) throw new Error("No blocks: pass spec files or --ledger <file>.");
  const found = await lookUp(rpc, [...blocks.map((b) => b.id), ...blocks.flatMap((b) => b.deps)]);
  const descriptions = await fullDescriptions(rpc, blocks, found);
  const projects = (await rpc("projects_list", {})) as { id: string; name: string }[];
  const fallbackProject = projects.find((p) => p.name === FALLBACK_PROJECT)?.id;
  if (!fallbackProject) throw new Error(`No "${FALLBACK_PROJECT}" project in Moduo.`);
  const steps = planImport({
    blocks,
    found,
    history: idsInHistory(),
    fallbackProject,
    openPrs: openPrsById(),
    descriptions,
  });
  if (dryRun) {
    for (const s of steps) console.log(planLine(s));
    return;
  }
  const tally = await applyPlan(rpc, steps, found, (l) => console.log(l));
  console.log(
    `queue:import: ${tally.created} created, ${tally.updated} updated, ${tally.edges} edges, ${tally.failed} failed.`,
  );
  if (tally.failed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`queue:import: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
