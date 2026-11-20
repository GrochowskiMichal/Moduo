// Best-of-3 drafts (Harness v3, HV-26, AC18): score the drafts of one Tier 2
// block and pick the one to keep. Every draft starts from the contract commit
// (the block's frozen contract tests) in its own worktree; for each one this
//   1. disqualifies it when it touched a frozen test path (.claude/settings.implement.json)
//      or isn't cut from the contract commit,
//   2. runs the check (the contract tests, plus --check) in the draft's worktree,
//   3. plants mutants in the source lines the draft added (operator, boolean and
//      ±1 swaps), runs the contract tests on each and counts the kills,
// then keeps the smallest passing diff among those within 5 points of the best
// kill rate, and prints the table the PR body carries.
//
//   bun run drafts <contract-ref> <draft-worktree>… [--test "<cmd>"] [--check "<cmd>"]
//                  [--base <ref>] [--max-mutants 25] [--json]
//
// --test defaults to the frozen tests the contract commit added since --base
// (default origin/<owner>, the owner from the contract branch t/<owner>/…), run
// per workspace. Every mutated file is put back after each run, also on Ctrl-C.
// Exit 1 when no draft is eligible. Tests: scripts/agent/drafts.test.ts.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globToRegExp } from "../ci/tier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Kill rates this close to the best count as equal, and then the smaller diff wins. */
export const KILL_BAND = 0.05;
export const DEFAULT_MAX_MUTANTS = 25;
/** Source a line mutant makes sense in; other changed files only count toward the diff size. */
const MUTABLE = /\.(?:[cm]?[jt]sx?|rs)$/;

/** The frozen test globs: the Edit denials of the implement phase (HV-18). */
export function frozenGlobs(root = ROOT): string[] {
  const settings = JSON.parse(
    readFileSync(path.join(root, ".claude/settings.implement.json"), "utf8"),
  );
  return (settings.permissions.deny as string[]).flatMap(
    (rule) => /^Edit\((.+)\)$/.exec(rule)?.[1] ?? [],
  );
}

export function isFrozen(file: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(file));
}

// ── Mutants ──────────────────────────────────────────────────────────────────

/** Swaps tried on each added line. Spaced binary operators only, so `=>`, generics and JSX stay put. */
const SWAPS: readonly (readonly [RegExp, string])[] = [
  [/ === /g, " !== "],
  [/ !== /g, " === "],
  [/ == /g, " != "],
  [/ != /g, " == "],
  [/ <= /g, " < "],
  [/ >= /g, " > "],
  [/ < /g, " <= "],
  [/ > /g, " >= "],
  [/ && /g, " || "],
  [/ \|\| /g, " && "],
  [/ \?\? /g, " || "],
  [/\btrue\b/g, "false"],
  [/\bfalse\b/g, "true"],
  [/ \+ 1\b/g, " - 1"],
  [/ - 1\b/g, " + 1"],
  [/\(!(?=[\w(])/g, "("],
];

const NOT_CODE = /^\s*(?:\/\/|\/\*|\*|import\b|export\s+(?:type\s+)?\{|use\b|#\[)/;

export type Mutant = { file: string; line: number; from: string; to: string };

/** Every one-swap mutant of one source line: each operator occurrence gives its own mutant. */
export function mutantsOfLine(text: string): string[] {
  if (NOT_CODE.test(text)) return [];
  const out: string[] = [];
  for (const [re, to] of SWAPS) {
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      out.push(text.slice(0, at) + to + text.slice(at + m[0].length));
    }
  }
  return out;
}

/** Added lines per file, by new line number, from `git diff -U0`. */
export function addedLines(diff: string): Map<string, Map<number, string>> {
  const files = new Map<string, Map<number, string>>();
  let current: Map<number, string> | null = null;
  let next = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const file = line.slice(4).replace(/^b\//, "");
      current = file === "/dev/null" ? null : new Map();
      if (current) files.set(file, current);
    } else if (line.startsWith("@@")) {
      next = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
    } else if (current && line.startsWith("+")) {
      current.set(next++, line.slice(1));
    }
  }
  return files;
}

/** Spread a sample of at most `max` mutants evenly over the list, the same each run. */
export function sample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)] as T);
}

export function mutantsOf(added: Map<string, Map<number, string>>, globs: readonly string[]) {
  const all: Mutant[] = [];
  for (const [file, lines] of added) {
    if (!MUTABLE.test(file) || isFrozen(file, globs)) continue;
    for (const [line, from] of lines) {
      for (const to of mutantsOfLine(from)) all.push({ file, line, from, to });
    }
  }
  return all;
}

// ── Picking ──────────────────────────────────────────────────────────────────

export type Draft = {
  name: string;
  branch: string;
  /** Why the draft can't win before any check runs, e.g. it edited a frozen test. */
  disqualified: string | null;
  checkPassed: boolean;
  /** Lines added plus removed outside the frozen test paths. */
  size: number;
  mutants: number;
  killed: number;
};

export const killRate = (d: Draft): number => (d.mutants === 0 ? 0 : d.killed / d.mutants);

/**
 * The draft to keep: eligible (not disqualified, check green), within KILL_BAND of
 * the best kill rate, then the smallest diff, then the higher kill rate, then the
 * first named. Null when none is eligible.
 */
export function pick(drafts: readonly Draft[]): { winner: Draft | null; why: string } {
  const eligible = drafts.filter((d) => !d.disqualified && d.checkPassed);
  if (eligible.length === 0) return { winner: null, why: "no draft passed its check" };
  const best = Math.max(...eligible.map(killRate));
  const band = eligible.filter((d) => killRate(d) >= best - KILL_BAND - 1e-9);
  const winner = [...band].sort(
    (a, b) => a.size - b.size || killRate(b) - killRate(a) || drafts.indexOf(a) - drafts.indexOf(b),
  )[0] as Draft;
  const why =
    band.length === 1
      ? `best kill rate (${pct(killRate(winner))})`
      : `smallest diff (${winner.size} lines) of ${band.length} within ${pct(KILL_BAND)} of the best kill rate`;
  return { winner, why };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The markdown block for the PR body. */
export function table(drafts: readonly Draft[]): string {
  const { winner, why } = pick(drafts);
  const rows = drafts.map((d) => {
    const check = d.disqualified ? `✗ ${d.disqualified}` : d.checkPassed ? "✓" : "✗ failed";
    const kills = d.mutants === 0 ? "no mutants" : `${d.killed}/${d.mutants} (${pct(killRate(d))})`;
    return `| ${d.name} | \`${d.branch}\` | ${check} | ${d.size} | ${kills} | ${d === winner ? "**kept**" : ""} |`;
  });
  return [
    "| Draft | Branch | Check | Diff (lines) | Mutants killed | |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    winner ? `Kept **${winner.name}**: ${why}.` : `No draft kept: ${why}.`,
  ].join("\n");
}

// ── Running ──────────────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

function sh(cwd: string, cmd: string, timeoutMs?: number): boolean {
  const r = spawnSync("sh", ["-c", cmd], { cwd, stdio: "ignore", timeout: timeoutMs });
  return r.status === 0;
}

/** One test command per workspace for the given test files. Null when a file has no runner here. */
export function testCommand(files: readonly string[]): string | null {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const ws = ["apps/app", "apps/landing", "supabase/functions"].find((w) =>
      file.startsWith(`${w}/`),
    );
    if (ws) {
      const cwd = ws === "supabase/functions" ? "supabase" : ws;
      groups.set(cwd, [...(groups.get(cwd) ?? []), path.relative(cwd, file)]);
    } else if (/^(scripts|tools)\//.test(file)) {
      groups.set(".", [...(groups.get(".") ?? []), file]);
    } else {
      return null;
    }
  }
  if (groups.size === 0) return null;
  return [...groups]
    .map(([cwd, fs]) =>
      cwd === "."
        ? `bunx rstest -c scripts/rstest.config.ts ${fs.join(" ")}`
        : `bun run --cwd ${cwd} test ${fs.join(" ")}`,
    )
    .join(" && ");
}

export type ScoreOptions = {
  contract: string;
  test: string;
  check?: string;
  maxMutants?: number;
  globs?: readonly string[];
  log?: (line: string) => void;
};

/** Lines changed outside the frozen paths, and the frozen paths the draft touched. */
function diffStats(worktree: string, contract: string, globs: readonly string[]) {
  const numstat = git(worktree, ["diff", "--numstat", "--no-renames", contract]).out;
  let size = 0;
  const touched: string[] = [];
  for (const row of numstat.split("\n").filter(Boolean)) {
    const [add, del, file] = row.split("\t") as [string, string, string];
    if (isFrozen(file, globs)) touched.push(file);
    else size += (Number(add) || 0) + (Number(del) || 0);
  }
  return { size, touched };
}

/** Run the test on one planted mutant; true when it fails or hangs. The file is always put back. */
function kills(worktree: string, m: Mutant, test: string, timeout: number): boolean {
  const file = path.join(worktree, m.file);
  const original = readFileSync(file, "utf8");
  const lines = original.split("\n");
  if (lines[m.line - 1] !== m.from) throw new Error(`${m.file}:${m.line} moved under the run`);
  lines[m.line - 1] = m.to;
  const restore = () => writeFileSync(file, original);
  const interrupted = () => {
    restore();
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  try {
    writeFileSync(file, lines.join("\n"));
    return !sh(worktree, test, timeout);
  } finally {
    restore();
    process.removeListener("SIGINT", interrupted);
  }
}

/** Score one draft worktree against the contract commit. Mutated files are restored before returning. */
export function scoreDraft(worktree: string, name: string, opts: ScoreOptions): Draft {
  const globs = opts.globs ?? frozenGlobs();
  const log = opts.log ?? (() => {});
  const branch = git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
  const draft: Draft = {
    name,
    branch,
    disqualified: null,
    checkPassed: false,
    size: 0,
    mutants: 0,
    killed: 0,
  };
  if (!git(worktree, ["merge-base", "--is-ancestor", opts.contract, "HEAD"]).ok) {
    return { ...draft, disqualified: "not cut from the contract commit" };
  }
  const { size, touched } = diffStats(worktree, opts.contract, globs);
  draft.size = size;
  if (touched.length > 0) return { ...draft, disqualified: `edited ${touched.join(", ")}` };

  const started = Date.now();
  draft.checkPassed = sh(worktree, opts.test) && (!opts.check || sh(worktree, opts.check));
  if (!draft.checkPassed) return draft;
  // A mutant that hangs counts as killed, like one that fails.
  const timeout = Math.max(60_000, 3 * (Date.now() - started));

  const diff = git(worktree, ["diff", "-U0", "--no-renames", opts.contract]).out;
  const mutants = sample(
    mutantsOf(addedLines(diff), globs),
    opts.maxMutants ?? DEFAULT_MAX_MUTANTS,
  );
  draft.mutants = mutants.length;
  for (const m of mutants) {
    const killed = kills(worktree, m, opts.test, timeout);
    if (killed) draft.killed++;
    log(`  ${name} ${killed ? "killed  " : "survived"} ${m.file}:${m.line}  ${m.to.trim()}`);
  }
  return draft;
}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** The contract tests the contract commit added since the base, as a command, or why there is none. */
function contractTests(argv: string[], contract: string, globs: readonly string[]) {
  const owner = /^t\/([^/]+)\//.exec(contract)?.[1] ?? process.env.MODUO_OWNER;
  const base = flag(argv, "--base") ?? (owner ? `origin/${owner}` : undefined);
  if (!base) return { error: "drafts: pass --test, or --base so the contract tests can be found." };
  const files = git(ROOT, ["diff", "--name-only", "--diff-filter=AM", `${base}...${contract}`])
    .out.split("\n")
    .filter((f) => f && isFrozen(f, globs));
  const test = testCommand(files);
  if (test) return { test };
  const named = files.join(", ") || "none";
  return {
    error: `drafts: no runnable contract tests between ${base} and ${contract} (${named}); pass --test.`,
  };
}

const USAGE =
  'usage: bun run drafts <contract-ref> <draft-worktree>… [--test "<cmd>"] [--check "<cmd>"] [--base <ref>] [--max-mutants N] [--json]';

function main(argv: string[]): number {
  const valued = new Set(["--test", "--check", "--base", "--max-mutants"]);
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1] ?? ""));
  const [contract, ...worktrees] = positional;
  if (!contract || worktrees.length === 0) {
    console.error(USAGE);
    return 64;
  }
  const globs = frozenGlobs();
  const found = flag(argv, "--test")
    ? { test: flag(argv, "--test") as string }
    : contractTests(argv, contract, globs);
  if (!("test" in found) || !found.test) {
    console.error(found.error);
    return 64;
  }
  const json = argv.includes("--json");
  const log = json ? () => {} : (line: string) => console.error(line);
  log(`contract tests: ${found.test}`);
  const drafts = worktrees.map((wt, i) =>
    scoreDraft(path.resolve(wt), `d${i + 1}`, {
      contract,
      test: found.test,
      check: flag(argv, "--check"),
      maxMutants: Number(flag(argv, "--max-mutants") ?? DEFAULT_MAX_MUTANTS),
      globs,
      log,
    }),
  );
  const { winner, why } = pick(drafts);
  if (json) console.log(JSON.stringify({ drafts, winner: winner?.name ?? null, why }));
  else console.log(table(drafts));
  return winner ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
