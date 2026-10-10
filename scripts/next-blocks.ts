#!/usr/bin/env bun
/**
 * Which execution blocks are ready to build right now.
 *
 * `specs/BUILD_ORDER.md` is the dependency graph (IDs, deps, lanes). The
 * *state* of a block is derived from GitHub, not from the checkbox:
 *   done    = a merged PR whose title starts with `[<ID>]` (or a legacy `[x]` tick)
 *   claimed = an open PR whose title starts with `[<ID>]` (or a legacy `[~]` tick)
 *   ready   = not done, not claimed, every dependency done
 *   waiting = a dependency is not done, or the deps are prose a human must judge
 *
 * Ledger line format (anything else is ignored, so keep to it):
 *   - [ ] **<ID> — <name>** · deps: <IDs, or —> · lane <name> · notes
 *
 * Usage:  bun run next            ready blocks, in ledger order
 *         bun run next --all      also claimed and waiting blocks
 *         bun run next --json     machine-readable
 *         bun run next TV-U5      the state of one block
 *         bun run next --offline  ledger ticks only, when gh is unavailable (never for claiming)
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

// Block IDs: PREFIX-segment(-segment)*, e.g. DF-15, MEET-0a, IM-2c-a, PRIV-2d.
const ID = /\b[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+\b/g;
// A ledger line; an emoji or marker may sit between the checkbox and the bold ID.
const LINE =
  /^\s*- \[( |~|x)\] (?:[^*\n]{0,8})?\*\*([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+)\s+[—–-]\s+([^*]+)\*\*(.*)$/;

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const wanted = args.find((a) => !a.startsWith("--")) ?? null;
const root = resolve(import.meta.dir, "..");
const ledger = readFileSync(resolve(root, "specs/BUILD_ORDER.md"), "utf8");
const log = readFileSync(resolve(root, "specs/BUILD_LOG.md"), "utf8");
const loggedIds = new Set((log.match(ID) ?? []).map((s) => s));

const focus = ledger.match(/^\*\*Focus:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null;

const blocks: Block[] = [];
ledger.split("\n").forEach((raw, i) => {
  const m = raw.match(LINE);
  if (!m) return;
  const [, tick, id, name, rest] = m;
  if (blocks.some((b) => b.id === id)) return; // a block listed twice (lane view) counts once
  const depsMatch = rest.match(/deps?:\s*([^·\n]+)/i);
  let deps: string[] = [];
  let depsNote: string | null = null;
  if (depsMatch) {
    const text = depsMatch[1].trim();
    deps = [...new Set((text.match(ID) ?? []).filter((d) => d !== id))];
    // Anything left after removing the IDs and separators is prose a human must judge.
    const leftover = text
      .replace(ID, "")
      .replace(/[—–\-,+/&·()\s]|\band\b|\bor\b|\bthen\b|\bdone\b|\bmerged\b/gi, "")
      .trim();
    if (leftover.length > 0) depsNote = text;
  }
  const lane = rest.match(/\blane\s+([a-z0-9-]+)/i)?.[1] ?? null;
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

type Pr = { title: string; number: number };
function gh(stateArg: "merged" | "open"): Pr[] | null {
  const r = Bun.spawnSync(
    ["gh", "pr", "list", "--state", stateArg, "--limit", "2000", "--json", "title,number"],
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
if (!ghOk && !flag("--offline")) {
  console.error(
    "gh pr list failed (not signed in, offline, or the wrong account is active: gh auth status). Block state cannot be derived; pass --offline to read the ledger ticks only, and never claim a block from that view.",
  );
  process.exit(2);
}
// Only a PR *titled* for the block counts: `[TV-U5] …`. A title that merely mentions an ID
// (a plan PR, a "Record X done" PR) is neither a claim nor a completion.
const prFor = (list: Pr[] | null, id: string) =>
  list?.find((p) => p.title.trimStart().startsWith(`[${id}]`))?.number;

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
const warnings: string[] = [];
for (const b of blocks) {
  if (b.state === "done") continue;
  const pr = prFor(open, b.id);
  if (pr !== undefined || b.tick === "~") {
    b.state = "claimed";
    b.pr = pr;
    continue;
  }
  // A dependency with no ledger line is done only if BUILD_LOG.md knows it (its section
  // was collapsed there). An unknown ID is probably a typo, so the block waits on it.
  const unmet = b.deps.filter((d) => (byId.has(d) ? !doneIds.has(d) : !loggedIds.has(d)));
  for (const d of unmet)
    if (!byId.has(d))
      warnings.push(`${b.id} depends on ${d}, which is in neither BUILD_ORDER.md nor BUILD_LOG.md`);
  b.blockedBy = unmet;
  b.state = unmet.length === 0 && !b.depsNote ? "ready" : "waiting";
}

const show = wanted
  ? blocks.filter((b) => b.id === wanted)
  : blocks.filter((b) => b.state !== "done" && (flag("--all") || b.state === "ready"));

if (wanted && show.length === 0) {
  console.error(
    `No block ${wanted} in specs/BUILD_ORDER.md (is its line in the \`- [ ] **ID — name**\` form?).`,
  );
  process.exit(1);
}

if (flag("--json")) {
  console.log(JSON.stringify({ ghOk, focus, warnings, blocks: show }, null, 2));
  process.exit(0);
}

if (!ghOk)
  console.log(
    "⚠ OFFLINE: state below comes from the ledger ticks only. Do not claim a block from this view.\n",
  );
if (focus) console.log(`Focus: ${focus}\n`);
if (show.length === 0)
  console.log(
    wanted ? "" : "Nothing is ready: every open block is claimed or waiting on a dependency.",
  );
for (const b of show) {
  const where =
    b.pr !== undefined ? ` · PR #${b.pr}` : b.state === "claimed" ? " · legacy [~] tick" : "";
  const why =
    b.state === "waiting"
      ? ` · waiting on ${[...(b.blockedBy ?? []), ...(b.depsNote ? [`"${b.depsNote}"`] : [])].join(", ")}`
      : "";
  console.log(
    `${b.state.padEnd(7)} ${b.id.padEnd(12)} ${b.name}${b.lane ? ` · lane ${b.lane}` : ""}${where}${why}`,
  );
}
for (const w of warnings) console.log(`⚠ ${w}`);
if (!wanted && !flag("--all"))
  console.log(
    "\nClaim one by opening a draft PR titled `[<ID>] <name>` (the /s2 skill does this).",
  );
