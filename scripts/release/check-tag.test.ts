import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// check-tag.sh's release-PR path: a merge whose tree is the PR head's (and whose first parent the
// head contains) counts the PR head's `checks` run; anything else waits for a push run as before.
const SCRIPT = resolve(import.meta.dir, "check-tag.sh");

function sh(cwd: string, cmd: string[]) {
  const r = Bun.spawnSync(cmd, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

/** A repo where develop gets a release merge tagged v1.0.0; `moveDevelop` lands another commit first. */
function fixture(moveDevelop: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "check-tag-"));
  const g = (...a: string[]) => sh(dir, ["git", ...a]);
  g("init", "-q", "-b", "develop");
  writeFileSync(join(dir, "VERSION"), "0.9.0\n");
  g("add", ".");
  g("commit", "-qm", "base");
  g("switch", "-qc", "release/v1.0.0");
  writeFileSync(join(dir, "VERSION"), "1.0.0\n");
  sh(dir, ["mkdir", "-p", "release-notes"]);
  writeFileSync(
    join(dir, "release-notes/releases.json"),
    JSON.stringify({ releases: [{ version: "1.0.0" }] }),
  );
  g("add", ".");
  g("commit", "-qm", "Release 1.0.0");
  const head = g("rev-parse", "HEAD");
  g("switch", "-q", "develop");
  if (moveDevelop) {
    writeFileSync(join(dir, "other.txt"), "x");
    g("add", ".");
    g("commit", "-qm", "other");
  }
  g("merge", "-q", "--no-ff", "-m", "Merge release", "release/v1.0.0");
  g("tag", "v1.0.0");
  g("update-ref", "refs/remotes/origin/develop", "develop");
  // A stub gh: a green PR run for the release head only, never a push run.
  const bin = join(dir, ".bin");
  sh(dir, ["mkdir", "-p", bin]);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash
case "$*" in
  *"--commit ${head}"*"--event pull_request"*) echo '[{"conclusion":"success","headBranch":"release/v1.0.0","url":"https://ci/pr"}]' ;;
  *) echo '[]' ;;
esac
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  return { dir, bin };
}

function check(f: { dir: string; bin: string }) {
  const r = Bun.spawnSync(["bash", SCRIPT, "v1.0.0"], {
    cwd: f.dir,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: "",
      GITHUB_STEP_SUMMARY: "",
    },
  });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

describe("check-tag.sh: the release PR's checks", () => {
  it("counts them when the merge changed nothing", () => {
    const r = check(fixture(false));
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "checks passed on the release PR's head with the same tree (https://ci/pr)",
    );
  });

  it("doesn't when develop moved under the PR (another tree ships)", () => {
    const r = check(fixture(true));
    expect(r.code).toBe(1);
    expect(r.out).toContain("checks has not run on a push of");
  });
});
