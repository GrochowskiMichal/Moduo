import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// specs/harness-v3.md AC13 · "no ledger instructions": the ledgers are gone,
// specs/BUILD_ORDER.md is a short pointer to the Moduo queue, and no skill or
// agent-facing doc tells an agent to tick, flip or move ledger lines.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const DELETED = ["specs/BUILD_LOG.md", "docs/build-log.md", "docs/testing"];

/** The files agents follow as instructions (closed runbooks under docs/agents/ are records). */
const SINGLE = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "REVIEW.md",
  "docs/agent-setup.md",
  "docs/agents/issue-tracker.md",
  "docs/release.md",
  "specs/_template.md",
];
const TREES = [".claude/skills", ".claude/agents", ".claude/rules", "tools/claude-plugins"];

function markdownUnder(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".md") && statSync(path.join(abs, f)).isFile())
    .map((f) => path.join(dir, f));
}

const files = [
  ...SINGLE.filter((f) => existsSync(path.join(ROOT, f))),
  ...TREES.flatMap(markdownUnder),
];

const DEAD_REF = /BUILD_LOG|build-log\.md|docs\/testing\//;
const LEDGER = /BUILD_ORDER|\bledger\b/i;
const EDIT = /\btick|\bflip|\bmove[sd]?\b.*\blines?\b|\[x\]|\[ \]|\[~\]|add (?:a|one) line/i;

describe("no ledger", () => {
  it("the build log, docs/build-log.md and docs/testing/ are deleted", () => {
    expect(DELETED.filter((p) => existsSync(path.join(ROOT, p)))).toEqual([]);
  });

  it("specs/BUILD_ORDER.md is a short pointer with no block lines", () => {
    const text = readFileSync(path.join(ROOT, "specs/BUILD_ORDER.md"), "utf8");
    expect(text.length).toBeLessThan(3000);
    expect(text).toMatch(/bun run queue/);
    expect(text.split("\n").filter((l) => /^\s*- \[[ x~]\]/.test(l))).toEqual([]);
  });

  it("scans the agent-facing files", () => {
    expect(files).toContain(".claude/skills/s2/SKILL.md");
    expect(files).toContain("tools/claude-plugins/moduo-agent/skills/moduo-agent/SKILL.md");
  });

  it("no skill or agent-facing doc names a deleted ledger or tells an agent to edit one", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(path.join(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (DEAD_REF.test(line) || (LEDGER.test(line) && EDIT.test(line)))
            hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
