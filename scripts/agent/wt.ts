// The worktree pool (Harness v3, HV-2): a ready worktree per session, and a
// prune that only ever removes what has landed.
//
//   bun run wt <name> [--base mike|maciej] [--no-install]
//     → .claude/worktrees/<name> on a new branch t/<owner>/<name>, cut off
//       origin/<base> (the personal branch), dependencies installed from Bun's
//       warm global cache, its own dev port (the scripts/agent/e2e-env.ts
//       scheme) written into its .claude/launch.json, your .env.local and
//       .claude/settings.local.json copied over from the main checkout.
//   bun run wt:prune [--dry-run]
//     → removes worktrees whose branch has a merged PR, never one with
//       uncommitted or untracked work, commits after the merge, a lock, a
//       detached HEAD, a personal or landing branch checked out, a running
//       process inside it (a live session), or the main checkout / the
//       worktree you are in.
//
// The base is --base, else $MODUO_OWNER, else the owner in the current branch
// (t/<owner>/… or the personal branch itself).

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { e2ePortFor } from "./e2e-env";

export const PERSONAL_BRANCHES = ["mike", "maciej"] as const;
/** Branches a landed PR ends up in: a tip reachable from one of these is merged. */
export const LANDING_BRANCHES = ["develop", ...PERSONAL_BRANCHES] as const;
/** Personal files a fresh worktree needs and git doesn't carry (all gitignored). */
export const COPIED_FILES = [".env.local", ".env.cloud.local", ".claude/settings.local.json"];

export type Worktree = {
  path: string;
  head: string;
  /** Short branch name, null when detached. */
  branch: string | null;
  locked: boolean;
  /** git marks it prunable when its directory is gone. */
  missing: boolean;
};

export function parseWorktreeList(porcelain: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    const lines = block.split("\n").filter(Boolean);
    const first = lines[0];
    if (!first?.startsWith("worktree ")) continue;
    const wt: Worktree = {
      path: first.slice("worktree ".length),
      head: "",
      branch: null,
      locked: false,
      missing: false,
    };
    for (const line of lines.slice(1)) {
      if (line.startsWith("HEAD ")) wt.head = line.slice(5);
      else if (line.startsWith("branch ")) wt.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "locked" || line.startsWith("locked ")) wt.locked = true;
      else if (line === "prunable" || line.startsWith("prunable ")) wt.missing = true;
    }
    out.push(wt);
  }
  return out;
}

export type PruneFacts = {
  isMain: boolean;
  isCurrent: boolean;
  /** A running process has its working directory inside (a live session or shell). */
  busy: boolean;
  /** Head SHAs of the merged PRs whose head branch is this worktree's branch. */
  mergedHeads: string[];
  /** Uncommitted or untracked (not ignored) changes; computed only when needed. */
  dirty: () => boolean;
  /** The tip is reachable from a landing branch; computed only when needed. */
  tipLanded: () => boolean;
};

export type Verdict = { remove: boolean; reason: string };

export function decidePrune(wt: Worktree, f: PruneFacts): Verdict {
  if (f.isMain) return { remove: false, reason: "main checkout" };
  if (f.isCurrent) return { remove: false, reason: "you are in it" };
  if (wt.missing) return { remove: false, reason: "directory gone (git worktree prune clears it)" };
  if (wt.locked) return { remove: false, reason: "locked" };
  if (!wt.branch) return { remove: false, reason: "detached HEAD" };
  // `mike` → `develop` PRs merge too; never take a personal branch with them.
  if ((LANDING_BRANCHES as readonly string[]).includes(wt.branch))
    return { remove: false, reason: "personal or landing branch" };
  if (f.busy) return { remove: false, reason: "a running process is in it" };
  if (f.mergedHeads.length === 0) return { remove: false, reason: "no merged PR" };
  if (!f.mergedHeads.includes(wt.head) && !f.tipLanded())
    return { remove: false, reason: "commits after the merge" };
  if (f.dirty()) return { remove: false, reason: "uncommitted or untracked work" };
  return { remove: true, reason: "merged" };
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveBase(opts: {
  flag?: string;
  env?: string;
  currentBranch?: string | null;
}): string {
  const pick = opts.flag ?? opts.env ?? ownerOf(opts.currentBranch ?? "");
  if (!pick) throw new Error("no base: pass --base mike|maciej or set MODUO_OWNER");
  if (!(PERSONAL_BRANCHES as readonly string[]).includes(pick))
    throw new Error(
      `base must be a personal branch (${PERSONAL_BRANCHES.join(", ")}), got "${pick}"`,
    );
  return pick;
}

function ownerOf(branch: string): string | undefined {
  if ((PERSONAL_BRANCHES as readonly string[]).includes(branch)) return branch;
  return branch.match(/^t\/([^/]+)\//)?.[1];
}

/** The preview tools' config for the new worktree: its own port for "web". */
export function launchConfigFor(port: number, existing?: string): string {
  type Conf = { name: string; [k: string]: unknown };
  let configurations: Conf[] = [];
  try {
    configurations = existing ? (JSON.parse(existing).configurations ?? []) : [];
  } catch {
    configurations = [];
  }
  const web: Conf = {
    name: "web",
    // Rsbuild directly, as e2e/playwright.config.ts does: `dev:web` pins 8081.
    runtimeExecutable: "sh",
    runtimeArgs: [
      "-c",
      `cd apps/app && MODUO_TARGET=web exec ../../node_modules/.bin/rsbuild dev --host 127.0.0.1 --port ${port}`,
    ],
    port,
  };
  const rest = configurations.filter((c) => c.name !== "web");
  return `${JSON.stringify({ version: "0.0.1", configurations: [web, ...rest] }, null, 2)}\n`;
}

type Run = { ok: boolean; out: string; err: string };
function git(cwd: string, ...args: string[]): Run {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
function must(r: Run, what: string): string {
  if (!r.ok) throw new Error(`${what}: ${r.err || r.out}`);
  return r.out;
}

/** The main checkout: the first entry of `git worktree list`. */
export function mainRootOf(cwd: string): string {
  return parseWorktreeList(
    must(git(cwd, "worktree", "list", "--porcelain"), "git worktree list"),
  )[0].path;
}

export type CreateOpts = {
  name: string;
  base: string;
  /** The main checkout (worktrees go in its .claude/worktrees/). */
  mainRoot: string;
  install?: boolean;
  log?: (line: string) => void;
};

export function createWorktree(o: CreateOpts): { path: string; branch: string; port: number } {
  const log = o.log ?? (() => {});
  if (!KEBAB.test(o.name)) throw new Error(`name must be kebab-case, got "${o.name}"`);
  const branch = `t/${o.base}/${o.name}`;
  const dir = path.join(o.mainRoot, ".claude", "worktrees", o.name);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  if (git(o.mainRoot, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).ok)
    throw new Error(`branch ${branch} already exists`);

  must(git(o.mainRoot, "fetch", "--quiet", "origin", o.base), `git fetch origin ${o.base}`);
  // --no-track: a task branch must not push to the personal branch by accident.
  must(
    git(
      o.mainRoot,
      "worktree",
      "add",
      "--quiet",
      "--no-track",
      "-b",
      branch,
      dir,
      `origin/${o.base}`,
    ),
    "git worktree add",
  );
  log(`worktree ${dir} on ${branch} (off origin/${o.base})`);

  for (const rel of COPIED_FILES) {
    const from = path.join(o.mainRoot, rel);
    if (!existsSync(from)) continue;
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    copyFileSync(from, path.join(dir, rel));
    log(`copied ${rel}`);
  }

  const port = e2ePortFor(realpathSync(dir));
  const mainLaunch = path.join(o.mainRoot, ".claude", "launch.json");
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  writeFileSync(
    path.join(dir, ".claude", "launch.json"),
    launchConfigFor(port, existsSync(mainLaunch) ? readFileSync(mainLaunch, "utf8") : undefined),
  );

  if (o.install !== false) {
    const t = Date.now();
    // Bun's global cache makes this a link step on a warm machine.
    const r = spawnSync("bun", ["install", "--frozen-lockfile", "--prefer-offline"], {
      cwd: dir,
      encoding: "utf8",
    });
    if (r.status !== 0)
      throw new Error(`bun install failed:\n${(r.stderr || r.stdout).slice(-2000)}`);
    log(`bun install ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  return { path: dir, branch, port };
}

export type MergedPr = { headRefName: string; headRefOid: string };

export function mergedPrsFromGh(cwd: string): MergedPr[] {
  const r = spawnSync(
    "gh",
    ["pr", "list", "--state", "merged", "--limit", "1000", "--json", "headRefName,headRefOid"],
    { cwd, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`gh pr list failed (is gh signed in?): ${r.stderr.trim()}`);
  return JSON.parse(r.stdout) as MergedPr[];
}

/** Every running process's working directory this user can see (macOS and Linux `lsof`). */
export function busyPathsFromLsof(): string[] {
  const r = spawnSync("lsof", ["-a", "-d", "cwd", "-Fn"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // lsof exits 1 when some processes can't be read; the rest of its output still holds.
  if (!r.stdout) throw new Error("lsof listed no processes; refusing to prune blind");
  return r.stdout
    .split("\n")
    .filter((l) => l.startsWith("n/"))
    .map((l) => l.slice(1));
}

export type PruneOpts = {
  cwd: string;
  merged: MergedPr[];
  /** Working directories of running processes (`busyPathsFromLsof`). */
  busyPaths?: string[];
  dryRun?: boolean;
  log?: (line: string) => void;
};

export type PruneRow = { path: string; branch: string | null } & Verdict;

export function prune(o: PruneOpts): PruneRow[] {
  const log = o.log ?? (() => {});
  const mainRoot = mainRootOf(o.cwd);
  const here = realpathSync(must(git(o.cwd, "rev-parse", "--show-toplevel"), "git rev-parse"));
  git(mainRoot, "fetch", "--quiet", "origin", ...LANDING_BRANCHES);
  const landed = LANDING_BRANCHES.filter(
    (b) => git(mainRoot, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${b}`).ok,
  );
  const heads = new Map<string, string[]>();
  for (const pr of o.merged)
    heads.set(pr.headRefName, [...(heads.get(pr.headRefName) ?? []), pr.headRefOid]);

  const rows: PruneRow[] = [];
  const list = parseWorktreeList(
    must(git(mainRoot, "worktree", "list", "--porcelain"), "git worktree list"),
  );
  for (const wt of list) {
    const real = existsSync(wt.path) ? realpathSync(wt.path) : wt.path;
    const v = decidePrune(wt, {
      isMain: wt.path === mainRoot,
      isCurrent: real === here,
      busy: (o.busyPaths ?? []).some((p) => p === real || p.startsWith(`${real}${path.sep}`)),
      mergedHeads: wt.branch ? (heads.get(wt.branch) ?? []) : [],
      dirty: () => {
        const s = git(wt.path, "status", "--porcelain", "--untracked-files=normal");
        return !s.ok || s.out !== "";
      },
      tipLanded: () =>
        landed.some((b) => git(mainRoot, "merge-base", "--is-ancestor", wt.head, `origin/${b}`).ok),
    });
    rows.push({ path: wt.path, branch: wt.branch, ...v });
    if (!v.remove) continue;
    if (o.dryRun) {
      log(`would remove ${wt.path} (${wt.branch})`);
      continue;
    }
    // No --force: git refuses again if anything changed since the check.
    const rm = git(mainRoot, "worktree", "remove", wt.path);
    if (!rm.ok) {
      rows[rows.length - 1] = {
        path: wt.path,
        branch: wt.branch,
        remove: false,
        reason: `git refused: ${rm.err}`,
      };
      continue;
    }
    git(mainRoot, "branch", "-D", wt.branch as string);
    log(`removed ${wt.path} (${wt.branch})`);
  }
  return rows;
}

function main(argv: string[]) {
  const log = (l: string) => console.log(`wt: ${l}`);
  const cwd = process.cwd();
  if (argv[0] === "prune") {
    const dryRun = argv.includes("--dry-run");
    const rows = prune({
      cwd,
      merged: mergedPrsFromGh(cwd),
      busyPaths: busyPathsFromLsof(),
      dryRun,
      log,
    });
    const kept = rows.filter((r) => !r.remove);
    const byReason = new Map<string, number>();
    for (const r of kept) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    const removed = rows.length - kept.length;
    log(
      `${dryRun ? "would remove" : "removed"} ${removed}, kept ${kept.length}: ${[...byReason].map(([r, n]) => `${n} ${r}`).join(", ")}`,
    );
    return;
  }
  const flagAt = argv.indexOf("--base");
  const name = argv.find((a, i) => !a.startsWith("--") && !(flagAt >= 0 && i === flagAt + 1));
  if (!name) {
    console.error(
      "usage: bun run wt <name> [--base mike|maciej] [--no-install]  ·  bun run wt:prune [--dry-run]",
    );
    process.exit(2);
  }
  const t = Date.now();
  const base = resolveBase({
    flag: flagAt >= 0 ? argv[flagAt + 1] : undefined,
    env: process.env.MODUO_OWNER || undefined,
    currentBranch: git(cwd, "branch", "--show-current").out || null,
  });
  const made = createWorktree({
    name,
    base,
    mainRoot: mainRootOf(cwd),
    install: !argv.includes("--no-install"),
    log,
  });
  log(
    `ready in ${((Date.now() - t) / 1000).toFixed(1)}s · dev port ${made.port} (preview "web" in its .claude/launch.json)`,
  );
  log(`cd ${made.path}`);
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`wt: ${(e as Error).message}`);
    process.exit(1);
  }
}
