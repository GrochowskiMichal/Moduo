#!/usr/bin/env bun
/**
 * Which execution blocks are ready to build right now.
 *
 * `specs/BUILD_ORDER.md` is the dependency graph (IDs, deps, lanes). The
 * *state* of a block is derived from GitHub, not from the checkbox:
 *   done    = a merged PR whose title names the block (or a legacy `[x]` tick)
 *   claimed = an open PR whose title names the block
 *   ready   = not done, not claimed, every dependency done
 *
 * Usage:  bun run next            ready blocks, in ledger order
 *         bun run next --all      also claimed and waiting blocks
 *         bun run next --json     machine-readable
 *         bun run next TV-U5      the state of one block
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type State = "done" | "claimed" | "ready" | "waiting";
type Block = {
  id: string;
  name: string;
  tick: " " | "~" | "x";
  deps: string[];
  depsNote: string | null;
  lane: string | null;
  line: number;
  state?: State;
  pr?: number;
  blockedBy?: string[];
};

const ID = /[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+[a-z]?|[A-Z][A-Z0-9]*-[A-Za-z0-9]+/g;
const LINE = /^\s*- \[( |~|x)\] \*\*([A-Z][A-Za-z0-9-]*)\s+[—-]\s+([^*]+)\*\*(.*)$/;

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const wanted = args.find((a) => !a.startsWith("--")) ?? null;
const root = resolve(import.meta.dir, "..");
const ledger = readFileSync(resolve(root, "specs/BUILD_ORDER.md"), "utf8");

const focus = ledger.match(/^\*\*Focus:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null;

const blocks: Block[] = [];
ledger.split("\n").forEach((raw, i) => {
  const m = raw.match(LINE);
  if (!m) return;
  const [, tick, id, name, rest] = m;
  const depsMatch = rest.match(/deps?:\s*([^·\n]+)/i);
  let deps: string[] = [];
  let depsNote: string | null = null;
  if (depsMatch) {
    const text = depsMatch[1].trim();
    deps = [...new Set((text.match(ID) ?? []).filter((d) => d !== id))];
    if (deps.length === 0 && !/^[—–-]\s*$/.test(text)) depsNote = text;
  }
  const lane = rest.match(/lane\s+([a-z0-9-]+)/i)?.[1] ?? null;
  if (blocks.some((b) => b.id === id)) return; // a block listed twice (lane view) counts once
  blocks.push({
    id,
    name: name.trim(),
    tick: tick as Block["tick"],
    deps,
    depsNote,
    lane,
    line: i + 1,
  });
});

function gh(stateArg: "merged" | "open"): { title: string; number: number }[] | null {
  const r = Bun.spawnSync(
    ["gh", "pr", "list", "--state", stateArg, "--limit", "500", "--json", "title,number"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) return null;
  try {
    return JSON.parse(r.stdout.toString());
  } catch {
    return null;
  }
}

const merged = gh("merged");
const open = gh("open");
const ghOk = merged !== null && open !== null;
const mentions = (title: string, id: string) =>
  new RegExp(`(^|[^A-Za-z0-9-])${id.replace(/[-]/g, "\\-")}([^A-Za-z0-9-]|$)`).test(title);
const prFor = (list: { title: string; number: number }[] | null, id: string) =>
  list?.find((p) => mentions(p.title, id))?.number;

const byId = new Map(blocks.map((b) => [b.id, b]));
const doneIds = new Set<string>();
for (const b of blocks) {
  const pr = prFor(merged, b.id);
  if (b.tick === "x" || pr !== undefined) {
    b.state = "done";
    b.pr = pr;
    doneIds.add(b.id);
  }
}
for (const b of blocks) {
  if (b.state === "done") continue;
  const pr = prFor(open, b.id);
  if (pr !== undefined) {
    b.state = "claimed";
    b.pr = pr;
    continue;
  }
  // A dependency that no line in the ledger defines counts as done: it was
  // finished and its section collapsed into BUILD_LOG.md.
  const unmet = b.deps.filter((d) => byId.has(d) && !doneIds.has(d));
  b.blockedBy = unmet;
  b.state = unmet.length === 0 && !b.depsNote ? "ready" : "waiting";
}

const show = wanted
  ? blocks.filter((b) => b.id === wanted)
  : blocks.filter((b) => b.state !== "done" && (flag("--all") || b.state === "ready"));

if (wanted && show.length === 0) {
  console.error(`No block ${wanted} in specs/BUILD_ORDER.md.`);
  process.exit(1);
}

if (flag("--json")) {
  console.log(JSON.stringify({ ghOk, focus, blocks: show }, null, 2));
  process.exit(0);
}

if (!ghOk) console.log("⚠ gh unavailable: state below comes from the ledger ticks only.\n");
if (focus) console.log(`Focus: ${focus}\n`);
if (show.length === 0)
  console.log(
    wanted ? "" : "Nothing is ready: every open block is claimed or waiting on a dependency.",
  );
for (const b of show) {
  const where = b.pr !== undefined ? ` · PR #${b.pr}` : "";
  const why =
    b.state === "waiting"
      ? ` · waiting on ${[...(b.blockedBy ?? []), ...(b.depsNote ? [`"${b.depsNote}"`] : [])].join(", ")}`
      : "";
  console.log(
    `${b.state.padEnd(7)} ${b.id.padEnd(12)} ${b.name}${b.lane ? ` · lane ${b.lane}` : ""}${where}${why}`,
  );
}
if (!wanted && !flag("--all"))
  console.log(
    "\nClaim one by opening a draft PR titled `[<ID>] <name>` (the /s2 skill does this).",
  );
