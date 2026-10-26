import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyAutoMode, withAutoMode } from "./auto-mode";

// The settings contract for the harness rails (HV-1: AC6, AC7, AC8).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const json = (file: string) => JSON.parse(read(file));

type Hook = { type: string; command: string; timeout?: number; onFailure?: string };
type Entry = { matcher?: string; hooks: Hook[] };
const settings = json(".claude/settings.json");
const entries = (event: string): Entry[] => settings.hooks[event] ?? [];
const allEntries = Object.keys(settings.hooks).flatMap(entries);

const GUARDS = [
  "guard-git",
  "guard-release",
  "guard-secrets",
  "guard-prod-db",
  "guard-glob",
  "guard-lane",
];

describe("settings.json", () => {
  it.each(GUARDS)("runs %s before tools and blocks when it fails", (guard) => {
    const found = entries("PreToolUse").flatMap((e) =>
      e.hooks.filter((h) => h.command.includes(`/.claude/hooks/${guard}.sh`)),
    );
    expect(found).toHaveLength(1);
    expect(found[0].onFailure).toBe("block");
    expect(found[0].timeout).toBeGreaterThan(0);
  });

  it("has no dead Entire todo hook", () => {
    expect(allEntries.map((e) => e.matcher ?? "")).not.toContainEqual(
      expect.stringMatching(/TaskCreate|TaskUpdate/),
    );
    expect(JSON.stringify(settings)).not.toContain("post-todo");
  });

  it("never sets bypass as the project default", () => {
    // Claude Code ignores "auto" here too; each person sets it with `bun run agent:auto-mode`.
    expect(settings.permissions?.defaultMode).toBeUndefined();
  });
});

describe("guards fail closed", () => {
  it.each(GUARDS)("%s exits non-zero (not a silent allow) when jq is missing", (guard) => {
    const run = spawnSync("/bin/bash", [path.join(ROOT, `.claude/hooks/${guard}.sh`)], {
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "git push origin develop" },
      }),
      env: { PATH: "/nonexistent" },
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("jq is missing");
  });
});

describe("/ship", () => {
  it("can only be started by a person typing it", () => {
    const frontmatter = read(".claude/skills/ship/SKILL.md").split("---")[1];
    expect(frontmatter).toMatch(/^disable-model-invocation: true$/m);
  });
});

describe("lane profile", () => {
  const lane = json(".claude/settings.lane.json");
  const srt = json(".claude/sandbox/lane.srt.json");

  it("marks the session as a lane and denies prod deploys", () => {
    expect(lane.env.MODUO_LANE).toBe("1");
    for (const rule of [
      "Bash(wrangler deploy*)",
      "Bash(bunx wrangler *)",
      "Bash(supabase db push*)",
      "Bash(supabase functions deploy*)",
      "Bash(gh workflow run*)",
      "Bash(gh release create*)",
      "Bash(git push *--tags*)",
      "mcp__supabase__apply_migration",
      "mcp__supabase__deploy_edge_function",
    ]) {
      expect(lane.permissions.deny).toContain(rule);
    }
  });

  it("allows only the hosts a lane needs", () => {
    for (const host of [
      "api.anthropic.com",
      "registry.npmjs.org",
      "github.com",
      "api.github.com",
      "127.0.0.1:54321",
      "127.0.0.1:54322",
    ]) {
      expect(srt.network.allowedDomains).toContain(host);
    }
    expect(srt.network.allowedDomains).not.toContainEqual(expect.stringMatching(/^\*/));
  });

  it("keeps the lane from editing its own rails or secrets", () => {
    for (const p of [
      ".claude/hooks",
      ".claude/settings.json",
      ".claude/settings.lane.json",
      ".env",
      "~/.claude/skills",
      "~/.claude/agents",
      "~/.bun/bin",
    ]) {
      expect(srt.filesystem.denyWrite).toContain(p);
    }
    expect(srt.filesystem.allowWrite).not.toContain("~/.bun");
    expect(srt.filesystem.allowWrite).not.toContain("~/.claude.json");
    expect(srt.filesystem.denyWrite).toContain("~/.claude.json");
  });
});

describe("scripts/agent/lane.sh", () => {
  const jq = spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();
  let bin: string;
  beforeEach(() => {
    bin = mkdtempSync(path.join(tmpdir(), "lane-bin-"));
    writeFileSync(path.join(bin, "claude"), "#!/bin/sh\necho claude-ran-outside-srt\n");
    chmodSync(path.join(bin, "claude"), 0o755);
  });
  afterEach(() => rmSync(bin, { recursive: true, force: true }));
  const lane = (extraEnv: Record<string, string>) =>
    spawnSync("bash", [path.join(ROOT, "scripts/agent/lane.sh"), "build HV-1"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        HOME: process.env.HOME ?? "/tmp",
        PATH: `${bin}:${path.dirname(jq)}:/usr/bin:/bin`,
        ...extraEnv,
      },
    });

  it("refuses to start without srt and never runs claude", () => {
    const run = lane({});
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("srt is not installed");
    expect(run.stdout).not.toContain("claude-ran");
  });

  it("runs claude in bypass only inside srt, with the composed profile", () => {
    const out = path.join(bin, "srt.out");
    writeFileSync(
      path.join(bin, "srt"),
      `#!/bin/bash\n{ echo "sandbox=$MODUO_LANE_SANDBOX lane=$MODUO_LANE"; echo "cmd=$4"; cat "$2"; } > "${out}"\n`,
    );
    chmodSync(path.join(bin, "srt"), 0o755);
    const run = lane({ TURBO_API: "https://cache.example.workers.dev/v8" });
    expect(run.status).toBe(0);
    const [envLine, cmdLine, ...rest] = readFileSync(out, "utf8").split("\n");
    expect(envLine).toBe("sandbox=1 lane=1");
    expect(cmdLine).toMatch(
      /^cmd=claude -p --permission-mode bypassPermissions --settings \S+\/\.claude\/settings\.lane\.json build\\ HV-1/,
    );
    const profile = JSON.parse(rest.join("\n"));
    expect(profile.$comment).toBeUndefined();
    expect(profile.network.allowedDomains).toContain("cache.example.workers.dev");
    expect(profile.filesystem.allowWrite).toContain(ROOT);
    expect(profile.filesystem.denyWrite).toContain(path.join(ROOT, ".claude/hooks"));
    const gitDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout.trim();
    expect(profile.filesystem.allowWrite).toContain(gitDir);
    expect(profile.filesystem.denyWrite).toEqual(
      expect.arrayContaining([`${gitDir}/hooks`, `${gitDir}/config`, path.join(ROOT, ".mcp.json")]),
    );
  });
});

describe("bun run agent:auto-mode", () => {
  it("sets auto as the default mode and keeps every other setting", () => {
    expect(
      withAutoMode({ model: "opus", permissions: { allow: ["Bash(ls)"], defaultMode: "default" } }),
    ).toEqual({
      model: "opus",
      permissions: { allow: ["Bash(ls)"], defaultMode: "auto" },
    });
    const dir = mkdtempSync(path.join(tmpdir(), "auto-mode-"));
    try {
      const file = path.join(dir, ".claude/settings.json");
      applyAutoMode(file);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        permissions: { defaultMode: "auto" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
