import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Frozen tests (HV-18, AC16): while implementing, the agent can't edit a test, through its file tools
// (.claude/settings.implement.json) or the shell (.claude/sandbox/implement.srt.json via lane.sh --implement).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const json = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
const implement = json(".claude/settings.implement.json");
const srt = json(".claude/sandbox/implement.srt.json");

const FROZEN = ["**/*.test.*", "**/*.spec.*", "supabase/tests/**", "benchmarks/**"];
const TESTS = [
  "scripts/agent/frozen-tests.test.ts",
  "apps/app/src/lib/sync/store.fake.spec.ts",
  "e2e/billing/invite-paywall.spec.ts",
  "supabase/tests/access_check.test.sql",
  "supabase/tests/_setup.sql",
  "supabase/functions/_shared/contracts/vocabularies.test.ts",
  "benchmarks/escapes/README.md",
];
const CODE = [
  "scripts/agent/lane.sh",
  "apps/app/src/lib/sync/store.ts",
  "supabase/functions/_shared/contracts/vocabularies.ts",
  "supabase/migrations/20261008013000_account_erase_workspace_data.sql",
  "specs/harness-v3.md",
];
const editGlobs = (deny: string[]) =>
  deny.flatMap((rule) => /^Edit\((.+)\)$/.exec(rule)?.[1] ?? []);
const frozen = (file: string, globs: string[]) => globs.some((g) => path.matchesGlob(file, g));

describe("test edits denied during implement", () => {
  it.each(FROZEN)("denies file edits on %s", (glob) => {
    // An Edit rule covers every file tool (Edit, Write, NotebookEdit); Claude Code ignores Write(path).
    expect(implement.permissions.deny).toContain(`Edit(${glob})`);
  });

  it("freezes every test path and no source path", () => {
    const globs = editGlobs(implement.permissions.deny);
    for (const file of TESTS) expect(frozen(file, globs)).toBe(true);
    for (const file of CODE) expect(frozen(file, globs)).toBe(false);
  });

  it("the sandbox denies shell writes to the same paths", () => {
    // srt treats a literal folder as everything beneath it, so supabase/tests stands for supabase/tests/**.
    expect(srt.filesystem.denyWrite.map((p: string) => (p.includes("*") ? p : `${p}/**`))).toEqual(
      FROZEN,
    );
  });

  it("the lane can't rewrite its own frozen profile", () => {
    expect(json(".claude/sandbox/lane.srt.json").filesystem.denyWrite).toEqual(
      expect.arrayContaining([".claude/settings.implement.json", ".claude/sandbox"]),
    );
  });
});

describe("scripts/agent/lane.sh --implement", () => {
  const jq = spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();
  let bin: string;
  beforeEach(() => {
    bin = mkdtempSync(path.join(tmpdir(), "lane-bin-"));
    writeFileSync(path.join(bin, "claude"), "#!/bin/sh\necho claude-ran-outside-srt\n");
    chmodSync(path.join(bin, "claude"), 0o755);
    // The stub srt records its env, the command, the srt profile and the --settings file claude gets.
    writeFileSync(
      path.join(bin, "srt"),
      `#!/bin/bash\nf=$(echo "$4" | sed -E 's/.*--settings ([^ ]+).*/\\1/')\n{ cat "$2"; echo; echo ---; cat "$f"; } > "${bin}/srt.out"\n`,
    );
    chmodSync(path.join(bin, "srt"), 0o755);
  });
  afterEach(() => rmSync(bin, { recursive: true, force: true }));
  const lane = (...args: string[]) => {
    const run = spawnSync("bash", [path.join(ROOT, "scripts/agent/lane.sh"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { HOME: process.env.HOME ?? "/tmp", PATH: `${bin}:${path.dirname(jq)}:/usr/bin:/bin` },
    });
    expect(run.status).toBe(0);
    const [profile, settings] = readFileSync(path.join(bin, "srt.out"), "utf8").split("\n---\n");
    return { profile: JSON.parse(profile), settings: JSON.parse(settings) };
  };

  it("adds the frozen paths to the lane's permissions and sandbox", () => {
    const { profile, settings } = lane("--implement", "build HV-26");
    expect(settings.env.MODUO_LANE).toBe("1");
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([...implement.permissions.deny, "Bash(wrangler deploy*)"]),
    );
    expect(profile.filesystem.denyWrite).toEqual(
      expect.arrayContaining([
        path.join(ROOT, "**/*.test.*"),
        path.join(ROOT, "**/*.spec.*"),
        path.join(ROOT, "supabase/tests"),
        path.join(ROOT, "benchmarks"),
        path.join(ROOT, ".claude/hooks"),
      ]),
    );
  });

  it("leaves tests writable outside the implement phase", () => {
    const { profile, settings } = lane("write the contract tests");
    expect(settings.permissions.deny).not.toContain("Edit(**/*.test.*)");
    expect(profile.filesystem.denyWrite).not.toContain(path.join(ROOT, "**/*.test.*"));
  });
});

// The real sandbox, on a scratch tree: srt applies write globs on macOS only (lanes run on the Mac).
const haveSrt = spawnSync("sh", ["-c", "command -v srt"]).status === 0;
describe.skipIf(process.platform !== "darwin" || !haveSrt)("srt with the implement profile", () => {
  it("blocks shell writes to tests and allows them to code", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "frozen-"));
    try {
      for (const d of ["src", "supabase/tests", "benchmarks/escapes"]) {
        mkdirSync(path.join(dir, d), { recursive: true });
      }
      writeFileSync(path.join(dir, "src/a.test.ts"), "keep\n");
      const profile = {
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: {
          denyRead: [],
          allowWrite: [dir],
          denyWrite: srt.filesystem.denyWrite.map((p: string) => path.join(dir, p)),
        },
      };
      writeFileSync(path.join(dir, "profile.json"), JSON.stringify(profile));
      const sh = (cmd: string) =>
        spawnSync("srt", ["--settings", path.join(dir, "profile.json"), "-c", cmd], {
          cwd: dir,
          encoding: "utf8",
        });
      for (const cmd of [
        "echo x >> src/a.test.ts",
        "sed -i '' s/keep/gone/ src/a.test.ts",
        "mv src/a.test.ts src/a.ts",
        "rm src/a.test.ts",
        "echo x > src/new.spec.ts",
        "echo x > supabase/tests/new.sql",
        "echo x > benchmarks/escapes/new.md",
      ]) {
        expect({ cmd, status: sh(cmd).status }).not.toEqual({ cmd, status: 0 });
      }
      expect(readFileSync(path.join(dir, "src/a.test.ts"), "utf8")).toBe("keep\n");
      expect(existsSync(path.join(dir, "src/new.spec.ts"))).toBe(false);
      expect(sh("echo x > src/a.ts").status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
