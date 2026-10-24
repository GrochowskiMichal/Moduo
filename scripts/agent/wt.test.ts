import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { e2ePortFor } from "./e2e-env";
import {
  createWorktree,
  decidePrune,
  launchConfigFor,
  parseWorktreeList,
  prune,
  type PruneFacts,
  resolveBase,
  type Worktree,
} from "./wt";

function sh(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

const wt = (over: Partial<Worktree> = {}): Worktree => ({
  path: "/x",
  head: "aaa",
  branch: "t/mike/a",
  locked: false,
  missing: false,
  ...over,
});
const facts = (over: Partial<PruneFacts> = {}): PruneFacts => ({
  isMain: false,
  isCurrent: false,
  busy: false,
  mergedHeads: ["aaa"],
  dirty: () => false,
  tipLanded: () => false,
  ...over,
});

describe("decidePrune", () => {
  it("removes a clean worktree whose branch tip is a merged PR's head", () => {
    expect(decidePrune(wt(), facts())).toEqual({ remove: true, reason: "merged" });
  });
  it("keeps anything without a merged PR, even when its tip is in a landing branch (a fresh worktree)", () => {
    expect(decidePrune(wt(), facts({ mergedHeads: [], tipLanded: () => true })).remove).toBe(false);
  });
  it("keeps uncommitted or untracked work, commits after the merge, locks, detached heads, main and current", () => {
    expect(decidePrune(wt(), facts({ dirty: () => true })).reason).toBe(
      "uncommitted or untracked work",
    );
    expect(decidePrune(wt({ head: "bbb" }), facts()).reason).toBe("commits after the merge");
    expect(decidePrune(wt({ locked: true }), facts()).remove).toBe(false);
    expect(decidePrune(wt({ branch: null }), facts()).remove).toBe(false);
    expect(decidePrune(wt({ missing: true }), facts()).remove).toBe(false);
    expect(decidePrune(wt(), facts({ isMain: true })).remove).toBe(false);
    expect(decidePrune(wt(), facts({ isCurrent: true })).remove).toBe(false);
  });
  it("keeps a live session's worktree and never takes a personal or landing branch", () => {
    expect(decidePrune(wt(), facts({ busy: true })).reason).toBe("a running process is in it");
    for (const branch of ["mike", "maciej", "develop"])
      expect(decidePrune(wt({ branch }), facts()).reason).toBe("personal or landing branch");
  });
  it("removes a merged branch whose tip moved on only into a landing branch", () => {
    expect(decidePrune(wt({ head: "bbb" }), facts({ tipLanded: () => true })).remove).toBe(true);
  });
});

describe("parseWorktreeList", () => {
  it("reads branches, detached heads, locks and prunable entries", () => {
    const list = parseWorktreeList(
      [
        "worktree /main\nHEAD 111\nbranch refs/heads/mike\n",
        "worktree /a\nHEAD 222\nbranch refs/heads/t/mike/a\nlocked reason\n",
        "worktree /b\nHEAD 333\ndetached\nprunable gitdir file points to non-existent location\n",
      ].join("\n"),
    );
    expect(list).toEqual([
      { path: "/main", head: "111", branch: "mike", locked: false, missing: false },
      { path: "/a", head: "222", branch: "t/mike/a", locked: true, missing: false },
      { path: "/b", head: "333", branch: null, locked: false, missing: true },
    ]);
  });
});

describe("resolveBase", () => {
  it("takes the flag, then MODUO_OWNER, then the owner of the current branch", () => {
    expect(resolveBase({ flag: "maciej", env: "mike" })).toBe("maciej");
    expect(resolveBase({ env: "mike", currentBranch: "t/maciej/x" })).toBe("mike");
    expect(resolveBase({ currentBranch: "t/maciej/x" })).toBe("maciej");
    expect(resolveBase({ currentBranch: "mike" })).toBe("mike");
  });
  it("refuses develop or an unknown base", () => {
    expect(() => resolveBase({ flag: "develop" })).toThrow(/personal branch/);
    expect(() => resolveBase({ currentBranch: "claude/x" })).toThrow(/no base/);
  });
});

describe("launchConfigFor", () => {
  it("points the web preview at the worktree's port and keeps the other entries", () => {
    const out = JSON.parse(
      launchConfigFor(
        8421,
        JSON.stringify({
          configurations: [
            { name: "web", port: 8081 },
            { name: "storybook", port: 6006 },
          ],
        }),
      ),
    );
    expect(out.configurations.map((c: { name: string }) => c.name)).toEqual(["web", "storybook"]);
    expect(out.configurations[0].port).toBe(8421);
    expect(out.configurations[0].runtimeArgs[1]).toContain("--port 8421");
  });
});

describe("pool hands out and prunes", () => {
  let tmp: string;
  let origin: string;
  let main: string;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wt-test-")));
    origin = path.join(tmp, "origin.git");
    main = path.join(tmp, "main");
    sh(tmp, "init", "--quiet", "--bare", "-b", "develop", origin);
    sh(tmp, "clone", "--quiet", origin, main);
    writeFileSync(path.join(main, ".gitignore"), ".claude/\n.env*.local\nnode_modules/\n");
    sh(main, "add", ".gitignore");
    sh(main, "commit", "--quiet", "-m", "init");
    sh(main, "push", "--quiet", "origin", "HEAD:develop", "HEAD:mike");
    writeFileSync(path.join(main, ".env.local"), "PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates a worktree off the personal branch with its env, its port and no upstream", () => {
    const made = createWorktree({ name: "alpha", base: "mike", mainRoot: main, install: false });
    expect(made.branch).toBe("t/mike/alpha");
    expect(made.path).toBe(path.join(main, ".claude/worktrees/alpha"));
    expect(sh(made.path, "rev-parse", "HEAD")).toBe(sh(main, "rev-parse", "origin/mike"));
    expect(readFileSync(path.join(made.path, ".env.local"), "utf8")).toContain("54321");
    expect(made.port).toBe(e2ePortFor(realpathSync(made.path)));
    const launch = JSON.parse(readFileSync(path.join(made.path, ".claude/launch.json"), "utf8"));
    expect(launch.configurations[0]).toMatchObject({ name: "web", port: made.port });
    expect(
      spawnSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], { cwd: made.path }).status,
    ).not.toBe(0);
    expect(() =>
      createWorktree({ name: "alpha", base: "mike", mainRoot: main, install: false }),
    ).toThrow(/exists/);
    expect(() =>
      createWorktree({ name: "Not Kebab", base: "mike", mainRoot: main, install: false }),
    ).toThrow(/kebab/);
  });

  it("prunes only the merged, clean worktree", () => {
    const merged = createWorktree({ name: "merged", base: "mike", mainRoot: main, install: false });
    const dirty = createWorktree({ name: "dirty", base: "mike", mainRoot: main, install: false });
    const open = createWorktree({ name: "open", base: "mike", mainRoot: main, install: false });
    const fresh = createWorktree({ name: "fresh", base: "mike", mainRoot: main, install: false });
    const live = createWorktree({ name: "live", base: "mike", mainRoot: main, install: false });
    for (const w of [merged, dirty, open, live]) {
      writeFileSync(path.join(w.path, `${path.basename(w.path)}.txt`), "x\n");
      sh(w.path, "add", ".");
      sh(w.path, "commit", "--quiet", "-m", path.basename(w.path));
    }
    // merged and dirty landed in mike (merge commit, as /s3 does); dirty then gets an edit.
    sh(main, "fetch", "--quiet", "origin");
    sh(main, "checkout", "--quiet", "-B", "mike", "origin/mike");
    sh(main, "merge", "--quiet", "--no-ff", "-m", "Merge", merged.branch, dirty.branch);
    sh(main, "push", "--quiet", "origin", "mike");
    writeFileSync(path.join(dirty.path, "wip.txt"), "unsaved\n");
    sh(main, "merge", "--quiet", "--no-ff", "-m", "Merge live", live.branch);
    sh(main, "push", "--quiet", "origin", "mike");
    const mergedPrs = [merged, dirty, live].map((w) => ({
      headRefName: w.branch,
      headRefOid: sh(w.path, "rev-parse", "HEAD"),
    }));

    const busyPaths = [path.join(live.path, "apps/app")];
    const dry = prune({ cwd: main, merged: mergedPrs, busyPaths, dryRun: true });
    expect(dry.filter((r) => r.remove).map((r) => r.branch)).toEqual([merged.branch]);
    expect(existsSync(merged.path)).toBe(true);

    const rows = prune({ cwd: main, merged: mergedPrs, busyPaths });
    const why = Object.fromEntries(rows.map((r) => [r.branch, r.reason]));
    expect(why[merged.branch]).toBe("merged");
    expect(why[dirty.branch]).toBe("uncommitted or untracked work");
    expect(why[open.branch]).toBe("no merged PR");
    expect(why[fresh.branch]).toBe("no merged PR");
    expect(why[live.branch]).toBe("a running process is in it");
    expect(why.mike).toBe("main checkout");
    expect(existsSync(merged.path)).toBe(false);
    expect(
      spawnSync("git", ["rev-parse", "--verify", `refs/heads/${merged.branch}`], { cwd: main })
        .status,
    ).not.toBe(0);
    for (const w of [dirty, open, fresh, live]) expect(existsSync(w.path)).toBe(true);
  });
});
