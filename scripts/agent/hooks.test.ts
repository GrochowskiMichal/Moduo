import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs every hook's own shell tests (.claude/hooks/*.test.sh) in verify (HV-1: AC1, AC6, AC7, AC9).
// Each script prints "<hook>: all passed" and exits 0 only when every case holds.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOKS = path.join(ROOT, ".claude/hooks");
const scripts = readdirSync(HOOKS)
  .filter((f) => f.endsWith(".test.sh"))
  .sort();

// A session's own switches must not leak into the cases that check their absence.
const env = { ...process.env };
for (const key of [
  "MODUO_SUPABASE_NO_PROMPT",
  "MODUO_LANE",
  "MODUO_LANE_SANDBOX",
  "MODUO_ALLOW_BYPASS",
  "GUARD_GIT_CLAUDE_CWDS",
]) {
  delete env[key];
}

describe(".claude/hooks", () => {
  it("has a shell test for every guard and the session-start hook", () => {
    for (const hook of [
      "guard-git",
      "guard-release",
      "guard-prod-db",
      "guard-glob",
      "guard-lane",
      "session-start",
    ]) {
      expect(scripts).toContain(`${hook}.test.sh`);
    }
  });

  it.each(scripts)("%s passes", (script) => {
    const run = spawnSync("bash", [path.join(HOOKS, script)], { encoding: "utf8", env });
    const name = script.replace(/\.test\.sh$/, "");
    expect(run.stdout + run.stderr).toContain(`${name}: all passed`);
    expect(run.status).toBe(0);
  });
});
