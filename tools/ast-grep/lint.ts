#!/usr/bin/env bun
/**
 * The ast-grep pack (`bun run lint:ast`, part of verify and CI's lint job).
 * Run from the repo root.
 *
 *   bun tools/ast-grep/lint.ts            fixtures, then the whole tree
 *   bun tools/ast-grep/lint.ts <file>…    only these files (the edit-time hook)
 *
 * Fixtures: each rule folder holds `fixtures/bad.*` (the pre-fix code) and
 * `fixtures/good.*` (the fixed code). A `// @flag` line in bad.* marks that the
 * next line must be reported; good.* must report nothing. The rule's `files`
 * scope is dropped for this check, so the fixtures can live next to the rule.
 *
 * Baseline: the matches that existed when a rule was added are listed in
 * tools/ast-grep/baseline.ts, each with why it's there. Only a match not in the
 * baseline fails. A full run also fails on a stale entry (its match is gone),
 * so the list only shrinks.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BASELINE, type BaselineEntry } from "./baseline";

// Plain Node APIs: Rstest imports this file on Node (lint.test.ts).
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PACK = path.join(ROOT, "tools/ast-grep");
const CONFIG = path.join(PACK, "sgconfig.yml");
const RULES = path.join(PACK, "rules");
/** What a full run scans; each rule's `files` narrows it further. */
const SCAN_ROOTS = ["apps/app/src", "apps/desktop/src-tauri/src"];
const SCANNED_EXT = /\.(ts|tsx|rs)$/;

export type Match = { rule: string; file: string; line: number; snippet: string; message: string };

type SgMatch = {
  ruleId: string;
  file: string;
  text: string;
  message?: string;
  range: { start: { line: number } };
};

/**
 * The pinned binary (root devDependency `@ast-grep/cli`). Its postinstall isn't
 * trusted, so go straight to the platform package instead of the shim.
 */
function binary(): string {
  const arch = process.arch;
  const pkg =
    process.platform === "darwin"
      ? `@ast-grep/cli-darwin-${arch}`
      : process.platform === "linux"
        ? `@ast-grep/cli-linux-${arch}-gnu`
        : `@ast-grep/cli-win32-${arch}-msvc`;
  try {
    const dir = path.dirname(createRequire(import.meta.url).resolve(`${pkg}/package.json`));
    const bin = path.join(dir, process.platform === "win32" ? "ast-grep.exe" : "ast-grep");
    if (existsSync(bin)) return bin;
  } catch {
    // fall through to the shim
  }
  return path.join(ROOT, "node_modules/.bin/ast-grep");
}

/** The matched code on one line, cut to 120 characters: the baseline key (no line numbers, so edits elsewhere don't stale it). */
export function snippetOf(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 120);
}

function run(args: string[]): SgMatch[] {
  const out = spawnSync(binary(), [...args, "--json=stream"], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  // ast-grep exits 1 when an error-level rule matches; anything else is a crash.
  if (out.status !== 0 && out.status !== 1) {
    throw new Error(`ast-grep ${args.join(" ")} failed:\n${String(out.stderr ?? out.error)}`);
  }
  return out.stdout
    .toString()
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as SgMatch);
}

function toMatch(m: SgMatch): Match {
  return {
    rule: m.ruleId,
    file: path.relative(ROOT, path.resolve(ROOT, m.file)).split(path.sep).join("/"),
    line: m.range.start.line + 1,
    snippet: snippetOf(m.text),
    message: m.message ?? "",
  };
}

export function scan(paths: string[]): Match[] {
  if (paths.length === 0) return [];
  return run(["scan", "-c", CONFIG, ...paths]).map(toMatch);
}

/** Matches the baseline doesn't cover, and baseline entries no match used up. */
export function compare(
  matches: Match[],
  baseline: readonly BaselineEntry[],
): { fresh: Match[]; stale: BaselineEntry[] } {
  const left = [...baseline];
  const fresh: Match[] = [];
  for (const m of matches) {
    const i = left.findIndex(
      (b) => b.rule === m.rule && b.file === m.file && b.snippet === m.snippet,
    );
    if (i === -1) fresh.push(m);
    else left.splice(i, 1);
  }
  return { fresh, stale: left };
}

/** The rule's YAML minus its top-level `files:` / `ignores:` lists. */
export function withoutScope(yml: string): string {
  return yml.replace(/^(files|ignores):[^\n]*\n(?:[ \t]+[^\n]*\n|[ \t]*\n)*/gm, "");
}

/** Each rule flags exactly its `@flag` lines in bad.* and nothing in good.*. */
export function checkFixtures(): string[] {
  const problems: string[] = [];
  for (const id of readdirSync(RULES).sort()) {
    const dir = path.join(RULES, id);
    const yml = readFileSync(path.join(dir, "rule.yml"), "utf8");
    const ruleId = /^id:\s*(\S+)\s*$/m.exec(yml)?.[1];
    if (ruleId !== id) problems.push(`${id}: rule.yml id is "${ruleId}"`);
    const rule = withoutScope(yml);
    const fixtures = path.join(dir, "fixtures");
    const files = existsSync(fixtures) ? readdirSync(fixtures).sort() : [];
    for (const kind of ["bad", "good"]) {
      if (!files.some((f) => f.startsWith(`${kind}.`)))
        problems.push(`${id}: no fixtures/${kind}.*`);
    }
    for (const f of files) problems.push(...checkFixture(id, rule, fixtures, f));
  }
  return problems;
}

/** One fixture: the rule flags exactly the line after each `// @flag`. */
function checkFixture(id: string, rule: string, fixtures: string, f: string): string[] {
  const problems: string[] = [];
  const file = path.join(fixtures, f);
  const lines = readFileSync(file, "utf8").split("\n");
  const want = lines.flatMap((l, i) => (/^\s*\/\/\s*@flag\s*$/.test(l) ? [i + 2] : []));
  if (f.startsWith("bad.") && want.length === 0) problems.push(`${id}/${f}: no // @flag line`);
  const got = run(["scan", "--inline-rules", rule, file]).map((m) => m.range.start.line + 1);
  const missed = want.filter((l) => !got.includes(l));
  const extra = got.filter((l) => !want.includes(l));
  if (missed.length) problems.push(`${id}/${f}: not flagged at line ${missed.join(", ")}`);
  if (extra.length) problems.push(`${id}/${f}: flagged unexpectedly at line ${extra.join(", ")}`);
  return problems;
}

function report(fresh: Match[]): void {
  console.error(
    `lint:ast: ${fresh.length} new match(es). Fix the code (each rule's note says how):`,
  );
  for (const m of fresh) {
    console.error(`  ${m.file}:${m.line}  [${m.rule}] ${m.message}\n    ${m.snippet}`);
  }
  console.error(
    "Rules and fixtures: tools/ast-grep/rules/<rule>/. Baseline (existing code only, never new code): tools/ast-grep/baseline.ts",
  );
}

function main(argv: string[]): number {
  const files = argv
    .map((f) => path.relative(ROOT, path.resolve(f)).split(path.sep).join("/"))
    .filter((f) => SCANNED_EXT.test(f) && existsSync(path.join(ROOT, f)));

  if (argv.length > 0) {
    // Edit-time: only these files; a stale entry elsewhere is the full run's business.
    const { fresh } = compare(scan(files), BASELINE);
    if (fresh.length) report(fresh);
    return fresh.length ? 1 : 0;
  }

  const problems = checkFixtures();
  for (const e of BASELINE) {
    if (e.why.trim() === "") problems.push(`baseline: ${e.rule} ${e.file} has no "why"`);
  }
  const { fresh, stale } = compare(scan(SCAN_ROOTS), BASELINE);
  for (const s of stale) {
    problems.push(`baseline: stale entry ${s.rule} ${s.file} "${s.snippet}" (gone: delete it)`);
  }
  if (problems.length) {
    console.error(`lint:ast: ${problems.length} problem(s) in the pack:`);
    for (const p of problems) console.error(`  ${p}`);
  }
  if (fresh.length) report(fresh);
  if (problems.length || fresh.length) return 1;
  console.log(`lint:ast: ok (${readdirSync(RULES).length} rules, ${BASELINE.length} baselined)`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
