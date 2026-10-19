import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs the release guard's own shell tests (.claude/hooks/guard-release.test.sh, AC6) in verify.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("guard-release.sh", () => {
  it("blocks release tags and prod workflows without a /ship marker, allows once with one", () => {
    const run = spawnSync("bash", [path.join(ROOT, ".claude/hooks/guard-release.test.sh")], {
      encoding: "utf8",
    });
    expect(run.stdout + run.stderr).toContain("guard-release: all passed");
    expect(run.status).toBe(0);
  });
});
