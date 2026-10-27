import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import {
  addedLines,
  type Draft,
  frozenGlobs,
  isFrozen,
  mutantsOfLine,
  pick,
  sample,
  scoreDraft,
  table,
  testCommand,
} from "./drafts.ts";

// Best-of-3 drafts (HV-26, specs/harness-v3.md AC18): the drafts of a Tier 2 block are
// scored on their check, their diff size and how many planted mutants the contract tests
// kill; a draft that edited a frozen test can't win.

const draft = (over: Partial<Draft>): Draft => ({
  name: "d1",
  branch: "t/mike/x-d1",
  disqualified: null,
  checkPassed: true,
  size: 10,
  mutants: 10,
  killed: 10,
  ...over,
});

describe("mutants of a line", () => {
  it("swaps each spaced operator occurrence on its own", () => {
    expect(mutantsOfLine("if (a === b && c > 1) return true;")).toEqual([
      "if (a !== b && c > 1) return true;",
      "if (a === b && c >= 1) return true;",
      "if (a === b || c > 1) return true;",
      "if (a === b && c > 1) return false;",
    ]);
  });

  it("leaves arrows, generics and JSX alone", () => {
    expect(mutantsOfLine("const f = (xs: Array<string>) => <div>{xs}</div>;")).toEqual([]);
  });

  it("drops a negation and flips ±1", () => {
    expect(mutantsOfLine("if (!ok) i = i + 1;")).toEqual([
      "if (!ok) i = i - 1;",
      "if (ok) i = i + 1;",
    ]);
  });

  it("skips comments and imports", () => {
    expect(mutantsOfLine("// a === b")).toEqual([]);
    expect(mutantsOfLine(" * true when a > b")).toEqual([]);
    expect(mutantsOfLine('import { x } from "y";')).toEqual([]);
  });
});

describe("diff parsing", () => {
  it("collects added lines by new line number, per file", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@ fn",
      "+one",
      "+two",
      "@@ -9 +11 @@",
      "-old",
      "+new",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    const added = addedLines(diff);
    expect([...added.keys()]).toEqual(["src/a.ts"]);
    expect([...(added.get("src/a.ts") ?? [])]).toEqual([
      [4, "one"],
      [5, "two"],
      [11, "new"],
    ]);
  });

  it("samples evenly and the same each time", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(sample(items, 4)).toEqual([0, 2, 5, 7]);
    expect(sample(items, 20)).toEqual(items);
  });
});

describe("frozen paths", () => {
  it("are the implement phase's Edit denials", () => {
    const globs = frozenGlobs();
    expect(globs).toContain("**/*.test.*");
    expect(isFrozen("apps/app/src/lib/sync/store.test.ts", globs)).toBe(true);
    expect(isFrozen("supabase/tests/access_check.test.sql", globs)).toBe(true);
    expect(isFrozen("apps/app/src/lib/sync/store.ts", globs)).toBe(false);
  });

  it("map to one test command per workspace", () => {
    expect(
      testCommand([
        "apps/app/src/lib/a.test.ts",
        "apps/app/src/lib/b.test.ts",
        "supabase/functions/_shared/contracts/v.test.ts",
        "scripts/agent/drafts.test.ts",
      ]),
    ).toBe(
      "bun run --cwd apps/app test src/lib/a.test.ts src/lib/b.test.ts && " +
        "bun run --cwd supabase test functions/_shared/contracts/v.test.ts && " +
        "bunx rstest -c scripts/rstest.config.ts scripts/agent/drafts.test.ts",
    );
    expect(testCommand(["supabase/tests/x.test.sql"])).toBeNull();
  });
});

describe("pick", () => {
  it("never keeps a disqualified or failing draft", () => {
    const { winner } = pick([
      draft({ name: "d1", disqualified: "edited a.test.ts", size: 1 }),
      draft({ name: "d2", checkPassed: false, size: 2 }),
      draft({ name: "d3", size: 30, killed: 5 }),
    ]);
    expect(winner?.name).toBe("d3");
  });

  it("keeps the smallest diff among kill rates within 5 points of the best", () => {
    const { winner, why } = pick([
      draft({ name: "d1", size: 40, killed: 10 }),
      draft({ name: "d2", size: 25, killed: 96, mutants: 100 }),
      draft({ name: "d3", size: 12, killed: 8 }),
    ]);
    expect(winner?.name).toBe("d2");
    expect(why).toMatch(/smallest diff/);
  });

  it("prefers a clearly better kill rate over a smaller diff", () => {
    const { winner } = pick([
      draft({ name: "d1", size: 10, killed: 6 }),
      draft({ name: "d2", size: 50, killed: 9 }),
    ]);
    expect(winner?.name).toBe("d2");
  });

  it("keeps nothing when no draft is eligible, and says so in the table", () => {
    const drafts = [draft({ checkPassed: false })];
    expect(pick(drafts).winner).toBeNull();
    expect(table(drafts)).toMatch(/No draft kept/);
  });
});

// A rehearsal of the race on a scratch repo: one draft edits the frozen test, one adds
// code the contract tests don't pin, one is the plain fix.
describe("three drafts in separate worktrees (AC18)", () => {
  const run = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (cwd: string, files: Record<string, string>, message: string) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      writeFileSync(path.join(cwd, file), text);
    }
    run(cwd, "add", ...Object.keys(files));
    run(cwd, "commit", "-q", "-m", message);
  };

  const TEST = [
    'import assert from "node:assert";',
    'import { clamp } from "./clamp.mjs";',
    "assert.equal(clamp(5, 1, 9), 5);",
    "assert.equal(clamp(0, 1, 9), 1);",
    "assert.equal(clamp(12, 1, 9), 9);",
    "assert.equal(clamp(4, 3, 3), 3);",
    "assert.throws(() => clamp(1, 9, 1));",
    "",
  ].join("\n");
  const PLAIN = [
    "export function clamp(n, lo, hi) {",
    "  if (lo > hi) throw new Error('empty range');",
    "  if (n < lo) return lo;",
    "  if (n > hi) return hi;",
    "  return n;",
    "}",
    "",
  ].join("\n");
  const EXTRA = PLAIN.replace(
    "  return n;",
    [
      "  return n;",
      "}",
      "export function wrap(n, lo, hi, loose = false) {",
      "  if (loose === true && n > hi) return lo + ((n - lo) % (hi - lo + 1));",
      "  return clamp(n, lo, hi);",
    ].join("\n"),
  );

  it("disqualifies the test edit, scores the rest and keeps the plain draft", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "hv26-drafts-"));
    try {
      run(repo, "init", "-q", "-b", "main");
      run(repo, "config", "user.email", "drafts@example.test");
      run(repo, "config", "user.name", "drafts");
      commit(repo, { "README.md": "scratch\n" }, "base");
      const base = run(repo, "rev-parse", "HEAD");
      commit(repo, { "src/clamp.test.mjs": TEST }, "Contract tests");
      const contract = run(repo, "rev-parse", "HEAD");

      const worktree = (name: string, from: string, files: Record<string, string>) => {
        const dir = path.join(repo, ".wt", name);
        run(repo, "worktree", "add", "-q", "-b", `t/mike/clamp-${name}`, dir, from);
        commit(dir, files, name);
        return dir;
      };
      const d1 = worktree("d1", contract, {
        "src/clamp.mjs": PLAIN,
        "src/clamp.test.mjs": TEST.replace("assert.throws(() => clamp(1, 9, 1));\n", ""),
      });
      const d2 = worktree("d2", contract, { "src/clamp.mjs": EXTRA });
      const d3 = worktree("d3", contract, { "src/clamp.mjs": PLAIN });
      const stray = worktree("d4", base, { "src/clamp.mjs": PLAIN });

      const opts = { contract, test: "node src/clamp.test.mjs", globs: ["**/*.test.*"] };
      const drafts = [d1, d2, d3, stray].map((wt, i) => scoreDraft(wt, `d${i + 1}`, opts));
      const [r1, r2, r3, r4] = drafts as [Draft, Draft, Draft, Draft];

      expect(r1.disqualified).toBe("edited src/clamp.test.mjs");
      expect(r4.disqualified).toBe("not cut from the contract commit");
      expect(r2.checkPassed && r3.checkPassed).toBe(true);
      expect(r2.size).toBeGreaterThan(r3.size);
      expect(r3.mutants).toBeGreaterThan(0);
      expect(r2.killed / r2.mutants).toBeLessThan(r3.killed / r3.mutants);
      expect(pick(drafts).winner?.name).toBe("d3");
      // Every mutated file is back as the draft wrote it.
      expect(readFileSync(path.join(d3, "src/clamp.mjs"), "utf8")).toBe(PLAIN);
      expect(run(d2, "status", "--porcelain")).toBe("");

      const md = table(drafts);
      for (const name of ["d1", "d2", "d3"])
        expect(md).toContain(`| ${name} | \`t/mike/clamp-${name}\``);
      expect(md).toMatch(/\| d3 .*\*\*kept\*\* \|/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
