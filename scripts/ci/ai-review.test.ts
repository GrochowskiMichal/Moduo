import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

// The AI review's contract (HV-6, AC21): PRs into develop only, same-repo, advisory, never a
// required check, comment-only, token only in its environment. Text checks: the repo has no YAML
// parser, and each line asserted here is one a careless edit would change.
const root = path.resolve(import.meta.dirname, "../..");
const workflows = path.join(root, ".github/workflows");
const read = (file: string) => fs.readFileSync(path.join(workflows, file), "utf8");
const review = read("ai-review.yml");
// Comments may say anything; the assertions are about what runs.
const code = review
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");

function blocks(text: string, key: string): string[] {
  // Every block of `key:`, up to the next line at the same or lower indent.
  const lines = text.split("\n");
  const found: string[] = [];
  lines.forEach((line, start) => {
    if (!line.trimStart().startsWith(`${key}:`)) return;
    const indent = line.length - line.trimStart().length;
    const end = lines.findIndex(
      (l, i) => i > start && l.trim() !== "" && l.length - l.trimStart().length <= indent,
    );
    found.push(lines.slice(start, end < 0 ? undefined : end).join("\n"));
  });
  return found;
}
const block = (text: string, key: string) => blocks(text, key)[0] ?? "";
// A job under `jobs:`, by its exact id.
const job = (id: string) => blocks(code, id).find((b) => b.startsWith(`  ${id}:`)) ?? "";
const JOBS = ["review", "tier", "catching-tests", "catching-tests-run", "catching-tests-post"];
const permsOf = (text: string) =>
  block(text, "permissions")
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);

describe("ai-review.yml", () => {
  it("runs only when a PR into develop is opened, reopened, made ready or labelled", () => {
    const on = block(code, "on");
    expect(on).toMatch(/^ {2}pull_request:$/m);
    expect(on).toMatch(/^ {4}branches: \[develop\]$/m);
    expect(on).toMatch(/^ {4}types: \[opened, reopened, ready_for_review, labeled\]$/m);
    expect(on.split("\n").filter((l) => /^ {2}\S/.test(l))).toEqual(["  pull_request:"]);
  });

  it("skips forks and drafts, and other labels", () => {
    const cond = block(code, "if");
    expect(cond).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(cond).toContain("!github.event.pull_request.draft");
    expect(cond).toContain(
      "(github.event.action != 'labeled' || github.event.label.name == 'ai-review')",
    );
  });

  it("is advisory: the job and the review step continue on error", () => {
    expect(job("review")).toMatch(/^ {4}continue-on-error: true$/m);
    const step = code.slice(code.indexOf("- name: Review"));
    expect(step).toMatch(/^ {8}continue-on-error: true$/m);
  });

  it("runs the built-in /code-review at medium on Sonnet 5, where medium votes", () => {
    expect(code).toMatch(
      /prompt: \/code-review medium --comment \$\{\{ github\.event\.pull_request\.number \}\}$/m,
    );
    expect(code).toMatch(/--model claude-sonnet-5$/m);
    expect(code).toContain("REVIEW.md");
    expect(code).toMatch(/classify_inline_comments: "false"/);
  });

  it("pins the action to a commit and keeps the token in the ai-review environment", () => {
    expect(code).toMatch(/uses: anthropics\/claude-code-action@[0-9a-f]{40} # v\d/);
    expect(code).toMatch(/environment:\n {6}name: ai-review\n {6}deployment: false/);
    expect(code).not.toMatch(/anthropic_api_key/);
  });

  it("review can only comment: read contents, write pull requests, nothing else", () => {
    expect(code).toMatch(/^permissions: \{\}$/m);
    expect(permsOf(job("review"))).toEqual(["contents: read", "pull-requests: write"]);
    const allowed = code.match(/--allowedTools "([^"]*)"/)?.[1].split(",") ?? [];
    expect(allowed).toContain("mcp__github_inline_comment__create_inline_comment");
    const denied = code.match(/--disallowedTools "([^"]*)"/)?.[1].split(",") ?? [];
    // Project allow rules load in CI; these keep PR code from running with the token around.
    for (const tool of [
      "Bash(bun:*)",
      "Bash(npm:*)",
      "Bash(gh api:*)",
      "mcp__supabase",
      "mcp__moduo",
    ]) {
      expect(denied).toContain(tool);
    }
    for (const tool of allowed) {
      expect(tool).not.toMatch(/^(Edit|Write|NotebookEdit|Bash|Bash\(gh api.*|Bash\(\*.*)$/);
    }
  });

  it("every job is advisory and skips forks, drafts and other labels at the root", () => {
    for (const id of JOBS) {
      expect(job(id)).not.toBe("");
      expect(job(id)).toMatch(/^ {4}continue-on-error: true$/m);
    }
    expect(block(job("tier"), "if")).toBe(block(job("review"), "if"));
    expect(job("catching-tests")).toMatch(/^ {4}needs: tier$/m);
    expect(job("catching-tests-run")).toMatch(/^ {4}needs: \[tier, catching-tests\]$/m);
    expect(job("catching-tests-post")).toMatch(/^ {4}needs: catching-tests-run$/m);
  });

  it("catching tests run only on Tier 2, classified by the base branch's tier.ts", () => {
    expect(job("catching-tests")).toContain("if: needs.tier.outputs.tier == 'tier-2'");
    expect(job("tier")).toContain(
      'git show "$PR_BASE:scripts/ci/tier.ts" > "$RUNNER_TEMP/tier.ts"',
    );
    // No env file and an empty bunfig: the PR's .env and bunfig.toml can't steer the classifier.
    expect(job("tier")).toContain(
      'bun --no-env-file --config="$RUNNER_TEMP/bunfig.toml" "$RUNNER_TEMP/tier.ts" --range "$PR_BASE...$PR_HEAD"',
    );
    expect(job("tier")).toMatch(/\^\[0-9a-f\]\{40\}\$/);
  });

  it("Claude proposes catching tests read-only, with a read-only token, as structured output", () => {
    const gen = job("catching-tests");
    expect(permsOf(gen)).toEqual(["contents: read"]);
    expect(gen).toMatch(/environment:\n {6}name: ai-review\n {6}deployment: false/);
    expect(gen).toMatch(/uses: anthropics\/claude-code-action@[0-9a-f]{40} # v\d/);
    expect(gen).toContain("tests: ${{ steps.propose.outputs.structured_output }}");
    expect(gen).toMatch(/--json-schema '\{.*"maxItems":5.*\}'$/m);
    const allowed = gen.match(/--allowedTools "([^"]*)"/)?.[1].split(",") ?? [];
    expect(allowed).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
    ]);
    const denied = gen.match(/--disallowedTools "([^"]*)"/)?.[1].split(",") ?? [];
    for (const tool of [
      "Edit",
      "Write",
      "Bash(gh:*)",
      "Bash(bun:*)",
      "Bash(bunx:*)",
      "Bash(node:*)",
    ]) {
      expect(denied).toContain(tool);
    }
  });

  it("the job that runs PR code has no secrets, no environment and a read-only token", () => {
    const run = job("catching-tests-run");
    expect(permsOf(run)).toEqual(["contents: read"]);
    expect(run).not.toMatch(/secrets\.|environment:/);
    expect(run).toContain("persist-credentials: false");
    // The proposals reach the shell through env, never as an expression in the script.
    expect(run).toContain("TESTS: ${{ needs.catching-tests.outputs.tests }}");
    const scripts = blocks(run, "run");
    expect(scripts.length).toBeGreaterThan(1);
    for (const script of scripts) expect(script).not.toMatch(/\$\{\{/);
  });

  it("the posting job runs no repo code: no checkout, no bun, only gh pr comment", () => {
    const post = job("catching-tests-post");
    expect(permsOf(post)).toEqual(["pull-requests: write"]);
    expect(post).not.toMatch(/actions\/checkout|bun |secrets\.|environment:/);
    expect(post).toContain('gh pr comment "$PR" --repo "$REPO" --body-file "$f"');
    // A re-run doesn't repeat a catch that is already on the PR.
    expect(post).toContain('grep -qxF "$head_line" posted.txt');
  });

  it("puts no PR-authored text into the prompt or a shell step", () => {
    expect(code).not.toMatch(
      /github\.event\.pull_request\.(title|body|head\.ref|head\.label)|github\.head_ref/,
    );
  });

  it("is never part of the required static-checks gate", () => {
    const gate = block(read("checks.yml"), "static-checks");
    expect(gate).not.toBe("");
    expect(gate).not.toMatch(/ai-review/);
    expect(block(gate, "needs")).not.toMatch(/\breview\b|catching-tests/);
  });

  it("is the only workflow that reads the Claude token", () => {
    const readers = fs
      .readdirSync(workflows)
      .filter((f) => read(f).includes("CLAUDE_CODE_OAUTH_TOKEN"));
    expect(readers).toEqual(["ai-review.yml"]);
  });
});
