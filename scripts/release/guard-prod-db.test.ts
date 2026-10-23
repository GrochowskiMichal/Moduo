import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs the Supabase write guard's own shell tests (.claude/hooks/guard-prod-db.test.sh) in verify.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("guard-prod-db.sh", () => {
  it("asks before Supabase writes, lifts only with the local opt-in, ignores other commands", () => {
    const run = spawnSync("bash", [path.join(ROOT, ".claude/hooks/guard-prod-db.test.sh")], {
      encoding: "utf8",
      env: { ...process.env, MODUO_SUPABASE_NO_PROMPT: "" },
    });
    expect(run.stdout + run.stderr).toContain("guard-prod-db: all passed");
    expect(run.status).toBe(0);
  });
});
