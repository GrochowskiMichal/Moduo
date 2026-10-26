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
    expect(block(code, "review")).toMatch(/^ {4}continue-on-error: true$/m);
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

  it("can only comment: read contents, write pull requests, nothing else", () => {
    const perms = blocks(code, "permissions");
    expect(perms).toHaveLength(1);
    const body = perms[0]
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);
    expect(body).toEqual(["contents: read", "pull-requests: write"]);
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

  it("puts no PR-authored text into the prompt or a shell step", () => {
    expect(code).not.toMatch(
      /github\.event\.pull_request\.(title|body|head\.ref|head\.label)|github\.head_ref/,
    );
  });

  it("is never part of the required static-checks gate", () => {
    const gate = block(read("checks.yml"), "static-checks");
    expect(gate).not.toBe("");
    expect(gate).not.toMatch(/ai-review/);
    expect(block(gate, "needs")).not.toMatch(/\breview\b/);
  });

  it("is the only workflow that reads the Claude token", () => {
    const readers = fs
      .readdirSync(workflows)
      .filter((f) => read(f).includes("CLAUDE_CODE_OAUTH_TOKEN"));
    expect(readers).toEqual(["ai-review.yml"]);
  });
});
