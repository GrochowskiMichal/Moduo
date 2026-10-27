import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

// Build, CI and agent-tooling traps that used to be gotcha entries (HV-14c, AC30): each one bit
// once, and each check is the line a careless edit would change. Text checks, like
// ai-review.test.ts: the repo has no YAML parser.
const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const workflowDir = ".github/workflows";
const workflows = fs
  .readdirSync(path.join(root, workflowDir))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: `${workflowDir}/${f}`, text: read(`${workflowDir}/${f}`) }));
// Comments may say anything; the checks are about what runs.
const code = (text: string) =>
  text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

const SKIP_DIRS = new Set(["node_modules", "dist", "target", "storybook-static"]);

function filesUnder(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (match.test(entry.name)) out.push(child);
    }
  };
  if (exists(dir)) walk(dir);
  return out;
}

/** The steps of a workflow, each from its `- name:`/`- uses:` line to the next step. */
function steps(text: string): string[] {
  return text.split(/\n(?=\s+- (?:name|uses|id):)/);
}

describe("workflows", () => {
  it("never hides a failing command behind export", () => {
    // `export X="$(cmd)"` returns 0 when cmd fails: assign first, then export.
    const shells = [
      ...workflows,
      ...[...filesUnder("scripts", /\.sh$/), ...filesUnder("infra", /\.sh$/)].map((file) => ({
        file,
        text: read(file),
      })),
    ];
    const hits = shells.flatMap(({ file, text }) =>
      code(text)
        .split("\n")
        .filter((l) => /\bexport\s+\w+="?\$\(/.test(l))
        .map((l) => `${file}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("uses $GITHUB_WORKSPACE, not the expression, in scripts", () => {
    // On Windows `shell: bash`, `${{ github.workspace }}` loses its backslashes (D:aModuoModuo).
    const hits = workflows.filter(({ text }) => code(text).includes("${{ github.workspace }}"));
    expect(hits.map((w) => w.file)).toEqual([]);
  });

  it("calls reusable workflows with secrets: inherit", () => {
    // An explicit `secrets:` list leaves environment secrets empty in the called jobs (2026-10-19:
    // every signed build got an empty TAURI_SIGNING_PRIVATE_KEY).
    const calls = workflows.flatMap(({ file, text }) =>
      code(text)
        .split(/\n(?=  [\w-]+:\n)/)
        .filter((job) => /uses: \.\/\.github\/workflows\//.test(job))
        .map((job) => ({ file, job })),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const { file, job } of calls) {
      expect({ file, inherit: /\n\s+secrets: inherit\b/.test(job) }).toEqual({
        file,
        inherit: true,
      });
    }
    const declared = workflows.filter(({ text }) =>
      /workflow_call:[\s\S]*?\n {4}secrets:/.test(code(text).split("\njobs:")[0] ?? ""),
    );
    expect(declared.map((w) => w.file)).toEqual([]);
  });

  it("keeps the Rust cache when a desktop build fails", () => {
    // Without cache-on-failure every failed signing run left Windows compiling cold (~17 min).
    const release = read(`${workflowDir}/_desktop-release.yml`);
    const caches = steps(code(release)).filter((s) => s.includes("Swatinem/rust-cache@"));
    expect(caches.length).toBeGreaterThan(0);
    for (const step of caches) expect(step).toMatch(/cache-on-failure: true/);
  });

  it("never hands Apple credentials to tauri build", () => {
    // APPLE_ID/APPLE_PASSWORD turn Tauri's own .app notarization back on, and APPLE_CERTIFICATE
    // imports a second cert (codesign hung 1.5 h). The workflow imports and notarizes itself.
    const release = read(`${workflowDir}/_desktop-release.yml`);
    const builds = steps(code(release)).filter((s) => /tauri build/.test(s));
    expect(builds.length).toBeGreaterThan(0);
    for (const step of builds) {
      expect(step).not.toMatch(/\bAPPLE_(ID|PASSWORD|CERTIFICATE)\s*:/);
    }
  });
});

describe("Workers", () => {
  it("export only handlers from their entry module", () => {
    // wrangler refuses a main module that exports a constant ("not of type 'function or
    // ExportedHandler'") though tsc and the tests pass. Logic and constants go in another module.
    const entries = filesUnder("infra", /^index\.ts$/).filter((f) =>
      /^infra\/[^/]+\/src\//.test(f),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const file of entries) {
      const exported = read(file).match(/^export\s+(?:const|let|var|class|enum)\s+\w+/gm) ?? [];
      expect({ file, exported }).toEqual({ file, exported: [] });
    }
  });
});

describe("workspaces", () => {
  it("lets a sparse suite pass an empty CI shard", () => {
    // CI runs every suite as --shard N/3, and rstest fails a shard that gets no files.
    const configs = execFileSync("git", ["ls-files", "*rstest.config.ts"], { cwd: root })
      .toString()
      .split("\n")
      .filter(Boolean);
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      const dir = path.dirname(config);
      const tests = filesUnder(dir, /\.test\.tsx?$/).length;
      if (tests >= 3 && dir !== "scripts") continue;
      expect({ config, passWithNoTests: /passWithNoTests:\s*true/.test(read(config)) }).toEqual({
        config,
        passWithNoTests: true,
      });
    }
  });

  it("keeps Bun's flat node_modules and turbo out of AGENTS.md", () => {
    // Workspaces switch Bun to its isolated linker (bundle changes, phantom deps break), and
    // turbo writes its own guidance block into AGENTS.md when it detects an agent.
    expect(read("bunfig.toml")).toMatch(/^linker = "hoisted"$/m);
    expect(JSON.parse(read("turbo.json"))).toMatchObject({ agentGuidance: false });
  });

  it("rebuilds the app when only the release notes change", () => {
    // release-notes/ is outside the app's workspace; without the input a cached build ships old notes.
    const tasks = JSON.parse(read("apps/app/turbo.json")).tasks as Record<
      string,
      { inputs?: string[] }
    >;
    for (const task of ["build", "typecheck", "test"]) {
      expect(tasks[task]?.inputs ?? []).toContain("$TURBO_ROOT$/release-notes/**");
    }
  });

  it("keeps typescript installed", () => {
    // It supplies tsc for every typecheck script and `tsc --lsp` for the ts7-lsp plugin.
    expect(JSON.parse(read("package.json")).devDependencies).toHaveProperty("typescript");
  });
});

describe("desktop bundle", () => {
  it("builds the frontend for the desktop target into frontendDist", () => {
    // A web-target build puts index.html in dist/web/ and stubs @tauri-apps/api/core, so the
    // bundle shows "asset not found: index.html". A stale dist/ hides it locally.
    const conf = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")).build as {
      beforeBuildCommand: string;
      frontendDist: string;
    };
    const script = /(\S+)$/.exec(conf.beforeBuildCommand)?.[1] ?? "";
    expect(JSON.parse(read("apps/app/package.json")).scripts[script]).toMatch(
      /MODUO_TARGET=desktop/,
    );
    expect(path.normalize(path.join("apps/desktop/src-tauri", conf.frontendDist))).toBe(
      path.normalize("apps/app/dist"),
    );
  });

  it("keeps the Liquid Glass app icon source", () => {
    // Lost in merges twice; `bun run icon:liquid` regenerates the icons from it.
    expect(exists("scripts/icons/source/Moduo.icon")).toBe(true);
  });
});

describe("project skills", () => {
  const skills = fs
    .readdirSync(path.join(root, ".claude/skills"), { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."));

  it("never link outside the repo", () => {
    // `npx skills add` symlinks into .claude/skills/ from a local .agents/ folder; committed,
    // every other clone gets dead links. A link to a committed plugin skill is fine.
    const tracked = new Set(
      execFileSync("git", ["ls-files", "tools/claude-plugins"], { cwd: root })
        .toString()
        .split("\n")
        .map((f) => path.dirname(f)),
    );
    const dangling = skills
      .filter((e) => e.isSymbolicLink())
      .map((e) => `.claude/skills/${e.name}`)
      .filter((link) => {
        const target = path.relative(
          root,
          path.resolve(root, path.dirname(link), fs.readlinkSync(path.join(root, link))),
        );
        return ![...tracked].some((dir) => dir === target || dir.startsWith(`${target}/`));
      });
    expect(dangling).toEqual([]);
  });

  it("never take a built-in command's name", () => {
    // A built-in slash command wins over a same-named skill, so `/plan` never reached ours.
    const reserved = new Set([
      "plan",
      "review",
      "simplify",
      "verify",
      "loop",
      "run",
      "init",
      "compact",
      "ultraplan",
      "ultrareview",
      "help",
      "clear",
      "config",
      "doctor",
      "model",
      "goal",
    ]);
    expect(skills.map((e) => e.name).filter((n) => reserved.has(n))).toEqual([]);
  });
});
