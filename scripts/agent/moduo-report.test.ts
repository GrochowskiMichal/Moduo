import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs the Moduo presence hook's own shell tests (tools/claude-plugins/moduo-agent/hooks/moduo-report.test.sh) in verify.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("moduo-report.sh", () => {
  it("reports online and idle only for a claimed task, and keeps the key off the command line", () => {
    const run = spawnSync(
      "bash",
      [path.join(ROOT, "tools/claude-plugins/moduo-agent/hooks/moduo-report.test.sh")],
      {
        encoding: "utf8",
      },
    );
    expect(run.stdout + run.stderr).toContain("moduo-report: all passed");
    expect(run.status).toBe(0);
  });
});
