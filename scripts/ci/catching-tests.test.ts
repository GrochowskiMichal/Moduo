import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import {
  commentBody,
  fence,
  judge,
  MARKER,
  parseRun,
  plain,
  type Proposal,
  rejectReason,
  runIn,
  suiteFor,
  summary,
} from "./catching-tests.ts";

const root = path.resolve(import.meta.dirname, "../..");
const ok = (p: Partial<Proposal> = {}): Proposal => ({
  path: "scripts/ci/tier.catching.test.ts",
  behavior: "The parent puts scripts/ci on Tier 2; the PR drops it.",
  code: 'import { it } from "@rstest/core";\nit("x", () => {});\n',
  ...p,
});
const never = () => false;

describe("suiteFor", () => {
  it("maps each workspace to the folder rstest runs from", () => {
    expect(suiteFor("apps/app/src/lib/a.catching.test.ts")?.cwd).toBe("apps/app");
    expect(suiteFor("supabase/functions/_shared/a.catching.test.ts")?.cwd).toBe("supabase");
    expect(suiteFor("scripts/ci/a.catching.test.ts")).toEqual({
      name: "scripts",
      cwd: ".",
      args: ["-c", "scripts/rstest.config.ts"],
    });
    expect(suiteFor("apps/desktop/src/a.catching.test.ts")).toBeNull();
    expect(suiteFor("tools/ast-grep/a.catching.test.ts")).toBeNull();
  });
});

describe("rejectReason", () => {
  it("accepts a new catching test under a suite", () => {
    expect(rejectReason(ok(), never, new Set())).toBeNull();
  });

  it("refuses paths that could escape the tree or overwrite a file", () => {
    expect(rejectReason(ok({ path: "../x.catching.test.ts" }), never, new Set())).toMatch(/plain/);
    expect(rejectReason(ok({ path: "/etc/x.catching.test.ts" }), never, new Set())).toMatch(
      /plain/,
    );
    expect(rejectReason(ok({ path: "scripts//x.catching.test.ts" }), never, new Set())).toMatch(
      /plain/,
    );
    expect(rejectReason(ok({ path: "scripts/ci/a b.catching.test.ts" }), never, new Set())).toMatch(
      /plain/,
    );
    expect(rejectReason(ok(), () => true, new Set())).toBe("path already exists");
    expect(rejectReason(ok(), never, new Set([ok().path]))).toBe("duplicate path");
  });

  it("only takes .catching.test files that a suite can collect, within size", () => {
    expect(rejectReason(ok({ path: "scripts/ci/tier.test.ts" }), never, new Set())).toMatch(
      /catching/,
    );
    expect(rejectReason(ok({ path: "infra/x.catching.test.ts" }), never, new Set())).toMatch(
      /no test suite/,
    );
    expect(rejectReason(ok({ code: "x".repeat(20_001) }), never, new Set())).toMatch(/too long/);
    expect(rejectReason({} as Proposal, never, new Set())).toBe("malformed proposal");
    const noBehavior = { path: ok().path, code: ok().code } as Proposal;
    expect(rejectReason(noBehavior, never, new Set())).toBe("malformed proposal");
  });
});

const report = (over: object) =>
  JSON.stringify({ summary: { testFiles: 1, tests: 1, failedTests: 0, passedTests: 1 }, ...over });

describe("parseRun", () => {
  it("passes only on exit 0 with at least one test and no failures", () => {
    expect(parseRun(0, report({})).status).toBe("pass");
    expect(parseRun(0, report({ summary: { testFiles: 1, tests: 0 } })).status).toBe("fail");
    expect(parseRun(0, report({ summary: { testFiles: 0 } })).status).toBe("not-collected");
    // Only skipped tests: nothing passed, so the parent proves nothing.
    const skipped = { testFiles: 1, tests: 1, failedTests: 0, passedTests: 0, skippedTests: 1 };
    expect(parseRun(0, report({ summary: skipped })).status).toBe("fail");
  });

  it("names the first failing test or the load error", () => {
    const failed = parseRun(
      1,
      report({
        summary: { testFiles: 1, tests: 2, failedTests: 1 },
        tests: [
          { status: "pass", fullName: "a" },
          { status: "fail", fullName: "tier > b", errors: [{ message: "expected 1 to be 2" }] },
        ],
      }),
    );
    expect(failed).toEqual({ status: "fail", message: "tier > b: expected 1 to be 2" });
    const load = parseRun(
      1,
      report({
        summary: { testFiles: 1, tests: 0 },
        files: [{ errors: [{ message: "Cannot find module './x'" }] }],
      }),
    );
    expect(load).toEqual({ status: "fail", message: "Cannot find module './x'" });
  });

  it("treats a timeout or a missing report as an error, never a failure", () => {
    expect(parseRun(null, "", true).status).toBe("error");
    expect(parseRun(2, "boom").status).toBe("error");
    // A preamble with a brace before the report doesn't break the parse.
    const preamble = `exclude: **/.{idea,git}/**\n${JSON.stringify({ summary: { testFiles: 0 } }, null, 2)}`;
    expect(parseRun(1, preamble).status).toBe("not-collected");
  });
});

describe("judge", () => {
  const pass = { status: "pass" as const, message: "" };
  const fail = { status: "fail" as const, message: "x" };
  const error = { status: "error" as const, message: "timed out" };
  it("catches only pass-on-parent, fail-on-head", () => {
    expect(judge(pass, fail).kind).toBe("caught");
    expect(judge(pass, pass).kind).toBe("missed");
    expect(judge(fail, fail).kind).toBe("missed");
    expect(judge(fail, pass).kind).toBe("missed");
    expect(judge(pass, error).kind).toBe("missed");
  });
});

describe("comment", () => {
  it("fences code longer than any backtick run inside it", () => {
    expect(fence("plain")).toBe("```");
    expect(fence("has ```` four")).toBe("`````");
  });

  it("defuses @-mentions and every HTML tag in model prose", () => {
    const zw = "\u200b";
    expect(plain("ping @mike <!-- x -->")).toBe(`ping @${zw}mike <${zw}!-- x -->`);
    // Stripping "<!--" once would rebuild a comment out of "<!<!---->": defusing can't be undone that way.
    expect(plain("a <!<!---->-- hidden")).not.toMatch(/<!--/);
    expect(plain('<img src="https://x.test/p.gif"><script>x</script >')).not.toMatch(/<[a-z/]/i);
    // Code spans read as written: no entities.
    expect(plain("`a && b < c`")).toBe(`\`a && b <${zw} c\``);
  });

  it("carries the marker, the behaviour, both commits, the failure and the test", () => {
    const body = commentBody(
      ok({ code: "const s = `x`;\n```\n" }),
      {
        kind: "caught",
        parent: { status: "pass", message: "" },
        head: { status: "fail", message: "expected 2 to be 1" },
      },
      { parent: "a".repeat(40), head: "b".repeat(40) },
    );
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("`scripts/ci/tier.catching.test.ts`");
    expect(body).toContain("The parent puts scripts/ci on Tier 2");
    expect(body).toContain("`aaaaaaaaa`");
    expect(body).toContain("`bbbbbbbbb`");
    expect(body).toContain("expected 2 to be 1");
    expect(body).toContain("````ts\nconst s");
    const html = commentBody(
      ok({ behavior: "hidden <!-- a --> <details><summary>x</summary>" }),
      {
        kind: "caught",
        parent: { status: "pass", message: "" },
        head: { status: "fail", message: "x" },
      },
      { parent: "a".repeat(40), head: "b".repeat(40) },
    );
    expect(html.slice(MARKER.length)).not.toMatch(/<!--|<details><summary>x/);
  });

  it("summarises every proposal with its outcome", () => {
    const text = summary(
      [
        {
          path: "a.catching.test.ts",
          outcome: { kind: "rejected", reason: "path already exists" },
        },
        {
          path: "b.catching.test.ts",
          outcome: judge({ status: "pass", message: "" }, { status: "fail", message: "x" }),
        },
      ],
      "Only one change is unit-testable.",
    );
    expect(text).toContain("Only one change is unit-testable.");
    expect(text).toContain("| `a.catching.test.ts` | rejected: path already exists |");
    expect(text).toContain("| `b.catching.test.ts` | **caught** · parent pass · head fail |");
    expect(summary([], "")).toContain("No proposals.");
    const forged = summary(
      [{ path: "x` <img src=//t.test> `\n| y", outcome: { kind: "rejected", reason: "bad path" } }],
      "",
    );
    expect(forged).not.toMatch(/` <img/);
    expect(forged.split("\n").filter((l) => l.startsWith("| `"))).toHaveLength(1);
  });
});

// End to end on two tiny trees: the same test passes on the parent, fails on the head, and the
// CLI writes one comment for it. Uses the repo's own rstest through a node_modules link.
describe("the CLI", () => {
  function nodeModules(): string {
    for (let dir = root; dir !== path.dirname(dir); dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules");
      if (fs.existsSync(path.join(candidate, "@rstest/core"))) return candidate;
    }
    throw new Error("no node_modules with @rstest/core");
  }

  function tree(dir: string, threshold: number): void {
    fs.mkdirSync(path.join(dir, "scripts/ci"), { recursive: true });
    fs.symlinkSync(nodeModules(), path.join(dir, "node_modules"));
    fs.writeFileSync(
      path.join(dir, "scripts/rstest.config.ts"),
      'import { defineConfig } from "@rstest/core";\n' +
        'export default defineConfig({ root: new URL("..", import.meta.url).pathname, include: ["scripts/ci/*.test.ts"] });\n',
    );
    fs.writeFileSync(
      path.join(dir, "scripts/ci/limit.ts"),
      `export const allowed = (n: number) => n <= ${threshold};\n`,
    );
  }

  const proposal: Proposal = {
    path: "scripts/ci/limit.catching.test.ts",
    behavior: "The parent allows 5; the PR stops at 4.",
    code:
      'import { expect, it } from "@rstest/core";\nimport { allowed } from "./limit.ts";\n' +
      'it("allows five", () => { expect(allowed(5)).toBe(true); });\n',
  };

  it("posts a catch for a test that passes on the parent and fails on the head", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "catching-"));
    try {
      tree(path.join(tmp, "parent"), 5);
      tree(path.join(tmp, "head"), 4);
      expect(runIn(path.join(tmp, "parent"), proposal).status).toBe("pass");
      // runIn removes the test again, so the tree is left as it was.
      expect(fs.existsSync(path.join(tmp, "parent", proposal.path))).toBe(false);

      const tests = path.join(tmp, "proposals.json");
      const rejected = { ...proposal, path: "scripts/ci/limit.ts" };
      fs.writeFileSync(tests, JSON.stringify({ tests: [proposal, rejected], note: "" }));
      const out = path.join(tmp, "out");
      const stdout = execFileSync(
        "bun",
        [
          path.join(root, "scripts/ci/catching-tests.ts"),
          ...["--tests", tests, "--out", out],
          ...["--parent", path.join(tmp, "parent"), "--head", path.join(tmp, "head")],
          ...["--parent-sha", "a".repeat(40), "--head-sha", "b".repeat(40)],
        ],
        { encoding: "utf8" },
      );
      expect(stdout.trim()).toBe("caught=1");
      expect(fs.readdirSync(path.join(out, "comments"))).toEqual(["1.md"]);
      const body = fs.readFileSync(path.join(out, "comments/1.md"), "utf8");
      expect(body).toContain("allows five: expected false to be true");
      const sum = fs.readFileSync(path.join(out, "summary.md"), "utf8");
      expect(sum).toContain("**caught** · parent pass · head fail");
      expect(sum).toContain("rejected: name must end in .catching.test.ts(x)");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
