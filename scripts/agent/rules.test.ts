import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENTS_MAX_BYTES,
  check,
  deadRefs,
  expired,
  globToRegExp,
  loadRules,
  parseFrontmatter,
  type Repo,
  type Rule,
  RULE_MAX_BYTES,
  ruleProblems,
  sizeProblems,
} from "./rules.ts";

// HV-10 (specs/harness-v3.md AC28, AC31): path rules carry paths, an incident
// and an expiry; no rule or agent doc names a missing file or script; root
// AGENTS.md and each path rule stay inside a byte budget.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const fakeRepo = (files: string[], scripts: string[] = [], ignored: string[] = []): Repo => ({
  root: "/repo",
  topLevel: new Set(files.map((f) => f.split("/")[0] ?? "")),
  exists: (rel) => files.some((f) => f === rel || f.startsWith(`${rel}/`)),
  ignored: (rel) => ignored.some((i) => rel === i || rel.startsWith(`${i}/`)),
  scripts: (dir) => (dir === "." ? new Set(scripts) : undefined),
});

const rule = (front: string, body = ""): Rule => {
  const text = `---\n${front}\n---\n\n${body}`;
  const fm = parseFrontmatter(text);
  const paths = Array.isArray(fm.paths) ? fm.paths : [];
  return {
    file: ".claude/rules/x.md",
    paths,
    incident: typeof fm.incident === "string" ? fm.incident : undefined,
    expires: typeof fm.expires === "string" ? fm.expires : undefined,
    text,
  };
};

describe("rules frontmatter (AC28)", () => {
  it("parses flow lists, block lists and quoted strings", () => {
    expect(parseFrontmatter('---\npaths: ["a/**", "b/*.ts"]\nincident: "x: y"\n---\n')).toEqual({
      paths: ["a/**", "b/*.ts"],
      incident: "x: y",
    });
    expect(
      parseFrontmatter("---\npaths:\n  - a/**\n  - 'b/**'\nexpires: 2027-01-31\n---\n"),
    ).toEqual({
      paths: ["a/**", "b/**"],
      expires: "2027-01-31",
    });
  });

  it("matches globs the way Claude Code does", () => {
    expect(globToRegExp("supabase/**").test("supabase/migrations/x.sql")).toBe(true);
    expect(globToRegExp("supabase/**").test("apps/supabase/x")).toBe(false);
    expect(globToRegExp("**/*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("src/*.{ts,tsx}").test("src/a.tsx")).toBe(true);
    expect(globToRegExp("src/*.{ts,tsx}").test("src/a/b.ts")).toBe(false);
  });

  it("needs paths, an incident and a YYYY-MM-DD expiry", () => {
    const reasons = ruleProblems(rule("expires: soon"), ["a.ts"]).map((p) => p.reason);
    expect(reasons).toEqual([
      expect.stringContaining("no `paths:`"),
      expect.stringContaining("no `incident:`"),
      expect.stringContaining("not a YYYY-MM-DD date"),
    ]);
  });

  it("flags a glob that matches no file", () => {
    const r = rule('paths: ["gone/**"]\nincident: "x"\nexpires: 2027-01-31');
    expect(ruleProblems(r, ["here/a.ts"])).toEqual([
      expect.objectContaining({ reason: "`gone/**` matches no file in the repo" }),
    ]);
  });

  it("lists expired rules as warnings by date", () => {
    const r = rule('paths: ["a"]\nincident: "x"\nexpires: 2026-01-01');
    expect(expired([r], "2026-10-26")).toEqual([r]);
    expect(expired([r], "2025-12-31")).toEqual([]);
  });
});

describe("dead references (AC31)", () => {
  const repo = fakeRepo(
    ["docs/gotchas/ui.md", "supabase/config.toml", "AGENTS.md", ".claude/rules/x.md"],
    ["verify", "local:reset"],
    ["docs/local"],
  );

  it("flags a missing file named in a link or a code span", () => {
    const text =
      "See [ui](../../docs/gotchas/ui.md) and [gone](../../docs/gotchas/gone.md).\nRun `supabase/old.sql`.";
    expect(deadRefs(".claude/rules/x.md", text, repo)).toEqual([
      {
        file: ".claude/rules/x.md",
        line: 1,
        reason: "names `docs/gotchas/gone.md`, which doesn't exist",
      },
      {
        file: ".claude/rules/x.md",
        line: 2,
        reason: "names `supabase/old.sql`, which doesn't exist",
      },
    ]);
  });

  it("flags a link into a gitignored folder (a wrong `../` from .claude/rules)", () => {
    const gitignored = fakeRepo(["docs/release.md", ".claude/rules/x.md"], [], [".claude"]);
    expect(
      deadRefs(
        ".claude/rules/x.md",
        "[r](../docs/release.md) · `.claude/SESSION_TITLE`",
        gitignored,
      ),
    ).toEqual([
      {
        file: ".claude/rules/x.md",
        line: 1,
        reason: "names `.claude/docs/release.md`, which doesn't exist",
      },
    ]);
  });

  it("flags a `bun run` script the package doesn't have", () => {
    expect(deadRefs("AGENTS.md", "`bun run verify` then `bun run local:wipe`", repo)).toEqual([
      {
        file: "AGENTS.md",
        line: 1,
        reason: "`bun run local:wipe`: no such script in the root package.json",
      },
    ]);
  });

  it("reads past `--silent` and leaves a script family (`local:*`) alone", () => {
    expect(
      deadRefs(
        "AGENTS.md",
        "`bun run --silent nope` · `bun run local:*` · `bun run --silent verify`",
        repo,
      ),
    ).toEqual([
      {
        file: "AGENTS.md",
        line: 1,
        reason: "`bun run nope`: no such script in the root package.json",
      },
    ]);
  });

  it("leaves globs, placeholders, URLs, gitignored and folder-relative paths alone", () => {
    const text = [
      "`supabase/**` · `docs/gotchas/<area>.md` · [x](https://a.b/c) · `docs/local/` · `functions/_shared/contracts/`",
      "```",
      "cat supabase/nothing.sql",
      "```",
      "`supabase/config.toml:12` · [anchor](#top)",
    ].join("\n");
    expect(deadRefs("AGENTS.md", text, repo)).toEqual([]);
  });
});

describe("size budgets", () => {
  const sized = (file: string, n: number): Rule => ({ file, paths: ["x/**"], text: "x".repeat(n) });

  it("fails an AGENTS.md over its budget and passes one at it", () => {
    expect(sizeProblems([], "x".repeat(AGENTS_MAX_BYTES), {})).toEqual([]);
    const [p] = sizeProblems([], "x".repeat(AGENTS_MAX_BYTES + 1), {});
    expect(p?.file).toBe("AGENTS.md");
    expect(p?.reason).toMatch(/every session carries it/);
  });

  it("counts bytes, not characters", () => {
    expect(sizeProblems([], "⛔".repeat(AGENTS_MAX_BYTES / 3 + 1), {})).toHaveLength(1);
  });

  it("holds a new rule to the limit and an older one to its recorded size", () => {
    const rules = [
      sized(".claude/rules/new.md", RULE_MAX_BYTES + 1),
      sized(".claude/rules/old.md", 6000),
      sized(".claude/rules/grown.md", 6001),
    ];
    const budget = { ".claude/rules/old.md": 6000, ".claude/rules/grown.md": 6000 };
    expect(sizeProblems(rules, "", budget).map((p) => p.file)).toEqual([
      ".claude/rules/new.md",
      ".claude/rules/grown.md",
    ]);
  });
});

describe("this repo", () => {
  it("has its folder rules as path rules, not folder AGENTS.md files", () => {
    const rules = loadRules(ROOT).map((r) => r.file);
    expect(rules).toEqual(
      expect.arrayContaining([
        ".claude/rules/ci-release.md",
        ".claude/rules/desktop-rust.md",
        ".claude/rules/supabase.md",
        ".claude/rules/ui-primitives.md",
      ]),
    );
    for (const dir of [
      "supabase",
      ".github",
      "apps/desktop/src-tauri",
      "apps/app/src/components/ui",
    ])
      expect(existsSync(path.join(ROOT, dir, "AGENTS.md"))).toBe(false);
  });

  it(`keeps every rule valid, every reference alive, AGENTS.md under ${AGENTS_MAX_BYTES} bytes and each rule in its budget`, () => {
    expect(check(ROOT)).toEqual([]);
  });

  it("keeps AGENTS.md's policy lines (AC39)", () => {
    const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/Anthropic only/);
    expect(agents).toMatch(/\bauto mode\b/);
    expect(agents).toMatch(/one Moduo connection/);
    expect(agents).toMatch(/\.claude\/rules\//);
    expect(agents).toMatch(
      /\*\*Two lanes\.\*\*[\s\S]*\*\*Fast lane:\*\*[\s\S]*\*\*Block lane:\*\*/,
    );
    expect(agents).toMatch(/the queue is in Moduo/);
  });
});
