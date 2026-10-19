import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs the release guard's own shell tests (.claude/hooks/guard-git.test.sh, AC6) in verify.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("guard-git.sh", () => {
  it("protects develop, mike and maciej and blocks bare force-pushes", () => {
    const run = spawnSync("bash", [path.join(ROOT, ".claude/hooks/guard-git.test.sh")], {
      encoding: "utf8",
    });
    expect(run.stdout + run.stderr).toContain("guard-git: all passed");
    expect(run.status).toBe(0);
  });
});
