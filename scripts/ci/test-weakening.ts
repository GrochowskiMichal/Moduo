/**
 * Test-weakening detector (HV-5, specs/harness-v3.md AC20): reads a diff of the test files and
 * flags the shortcuts that make a red suite green without fixing the code.
 *
 *   deleted-assertions  a test file ends up with fewer assertions than it had
 *   skip                a new .skip / .todo / xit / xdescribe (or skipIf/runIf)
 *   only                a new .only: it silently turns off every other test in the file
 *   sync-mock           a new mock or spy in an apps/app/src/lib/sync test, where the
 *                       real kernel is the thing under test
 *
 * Counts are net per file and per kind, so moving an assertion or renaming a file flags nothing;
 * a lost assertion is reported only when the whole change has fewer of them (a split file is
 * fine). String contents are ignored, so test data that quotes `it.only(` is not flagged. `only` is an error (exit 1); the rest are warnings for the reviewer: deleting a
 * stale test is sometimes right, and the PR's reviewer decides. A diff script, not a model.
 * Written in erasable TypeScript only, so `node` (type stripping) and `bun` both run it.
 *
 * CLI:
 *   bun scripts/ci/test-weakening.ts [<base>]       this branch against <base> (default
 *                                                   origin/develop), uncommitted changes included
 *   bun scripts/ci/test-weakening.ts --range A...B  a commit range (CI)
 * In GitHub Actions each finding is also printed as a workflow annotation.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type FindingKind = "deleted-assertions" | "skip" | "only" | "sync-mock";

export interface Finding {
  file: string;
  kind: FindingKind;
  severity: "error" | "warning";
  /** How many more were removed (deleted-assertions) or added (the rest) than the other way. */
  count: number;
  message: string;
}

export const TEST_FILE =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|(^supabase\/tests\/)|(^e2e\/.*\.[cm]?[jt]s$)/;
const SYNC_TESTS = /^apps\/app\/src\/lib\/sync\//;

const JS_ASSERTION = /\bexpect(?:\.\w+)?\s*\(|\bassert(?:\.\w+)?\s*\(/g;
// pgTAP, in supabase/tests/*.sql.
const SQL_ASSERTION =
  /\b(?:ok|is|isnt|results_eq|results_ne|set_eq|bag_eq|throws_ok|throws_like|lives_ok|row_eq|policy_cmd_is|policies_are|has_table|has_column|col_is_pk)\s*\(/gi;

const PATTERNS: Record<Exclude<FindingKind, "deleted-assertions">, RegExp> = {
  skip: /\b(?:it|test|describe|suite|bench)\s*\.\s*(?:skip|todo|skipIf|runIf)\b|\bx(?:it|test|describe)\s*\(/g,
  only: /\b(?:it|test|describe|suite|bench)\s*\.\s*only\b/g,
  "sync-mock":
    /\b(?:rs|vi|jest)\s*\.\s*(?:mock|doMock|fn|spyOn|stubGlobal|stubEnv)\s*\(|\.mock(?:Implementation|ReturnValue|ResolvedValue|RejectedValue)(?:Once)?\s*\(/g,
};

interface FileDiff {
  file: string;
  /** The path before a rename; the same as `file` otherwise. */
  oldFile: string;
  added: string[];
  removed: string[];
}

/** Applies one line of a file's header (before its first hunk); returns true at the first `@@`. */
function readHeader(current: FileDiff, line: string): boolean {
  if (line.startsWith("rename from ")) current.oldFile = line.slice(12);
  else if (line.startsWith("rename to ")) current.file = line.slice(10);
  return line.startsWith("@@");
}

/** Parses `git diff` output (renames detected) into added and removed lines per new path. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // A quoted path (special characters) doesn't match; its entry is kept, empty-named, so its
      // lines never land in the previous file. gitDiff turns quoting off anyway.
      const start = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = { file: start?.[2] ?? "", oldFile: start?.[1] ?? "", added: [], removed: [] };
      files.push(current);
      inHunk = false;
    } else if (current && !inHunk) {
      inHunk = readHeader(current, line);
    } else if (current && !line.startsWith("@@")) {
      if (line.startsWith("+")) current.added.push(line.slice(1));
      else if (line.startsWith("-")) current.removed.push(line.slice(1));
    }
  }
  return files;
}

function stripComment(line: string): string {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("--"))
    return "";
  return line.replace(/\s\/\/.*$/, "");
}

/** Empties string literals, so test data that quotes `it.only(` or `expect(` is not code. */
export function blankStrings(line: string): string {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "$1$1");
}

function count(lines: string[], re: RegExp, sql = false): number {
  let n = 0;
  // pgTAP assertions take string arguments; SQL strings never hold a call worth counting anyway.
  for (const line of lines)
    n += (sql ? stripComment(line) : blankStrings(stripComment(line))).match(re)?.length ?? 0;
  return n;
}

export function detect(diff: string): Finding[] {
  const findings: Finding[] = [];
  // A test renamed to a non-test path still counts: its assertions are what it lost.
  const tests = parseDiff(diff).filter((f) => TEST_FILE.test(f.file) || TEST_FILE.test(f.oldFile));
  const assertionsNet = (f: FileDiff) => {
    const sql = f.file.endsWith(".sql");
    const re = sql ? SQL_ASSERTION : JS_ASSERTION;
    return count(f.added, re, sql) - count(f.removed, re, sql);
  };
  // Splitting one test file into two loses assertions in one file and gains them in the other:
  // per-file losses are reported only when the change as a whole has fewer assertions.
  const totalLost = tests.reduce((n, f) => n + assertionsNet(f), 0) < 0;
  for (const f of tests) {
    const { file, added, removed } = f;
    const net = (re: RegExp) => count(added, re) - count(removed, re);

    const lostAssertions = totalLost ? -assertionsNet(f) : 0;
    if (lostAssertions > 0)
      findings.push({
        file,
        kind: "deleted-assertions",
        severity: "warning",
        count: lostAssertions,
        message: `${lostAssertions} assertion(s) fewer than before`,
      });
    const skips = net(PATTERNS["skip"]);
    if (skips > 0)
      findings.push({
        file,
        kind: "skip",
        severity: "warning",
        count: skips,
        message: `${skips} new skipped test(s)`,
      });
    const onlys = net(PATTERNS["only"]);
    if (onlys > 0)
      findings.push({
        file,
        kind: "only",
        severity: "error",
        count: onlys,
        message: `${onlys} new .only: every other test in the file stops running`,
      });
    if (SYNC_TESTS.test(file)) {
      const mocks = net(PATTERNS["sync-mock"]);
      if (mocks > 0)
        findings.push({
          file,
          kind: "sync-mock",
          severity: "warning",
          count: mocks,
          message: `${mocks} new mock(s) in a sync-kernel test`,
        });
    }
  }
  return findings;
}

function gitDiff(argv: string[]): string {
  const rangeAt = argv.indexOf("--range");
  let target: string[];
  if (rangeAt >= 0) {
    const range = argv[rangeAt + 1];
    if (!range) throw new Error("--range needs A...B");
    target = [range];
  } else {
    const base = argv.find((a) => !a.startsWith("--")) ?? "origin/develop";
    target = [execFileSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" }).trim()];
  }
  return execFileSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-M",
      "--unified=0",
      ...target,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = detect(gitDiff(process.argv.slice(2)));
  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const f of findings) {
    console.log(`${f.severity === "error" ? "✖" : "⚠"} ${f.file}: ${f.message} (${f.kind})`);
    if (annotate) console.log(`::${f.severity} file=${f.file}::Test weakening: ${f.message}`);
  }
  if (findings.length === 0) console.log("No test weakening found.");
  if (findings.some((f) => f.severity === "error")) process.exit(1);
}
