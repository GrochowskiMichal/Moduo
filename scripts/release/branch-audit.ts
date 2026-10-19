#!/usr/bin/env bun
// Lists every remote branch for cleanup (REL-6, AC13). Read-only: it never deletes anything.
//
//   bun scripts/release/branch-audit.ts            text report, after `git fetch --prune origin`
//   bun scripts/release/branch-audit.ts --json     the same as JSON
//   bun scripts/release/branch-audit.ts --names merged   one name per line, for a reviewed deletion
//   --no-fetch skips the fetch; --base <ref> compares against another ref (default origin/develop)
//
// Buckets:
//   kept      develop, mike, maciej (long-lived; never deleted)
//   mirror    prod-app, staging-app, prod-landing, main (retired by REL-6; each deleted only on a yes)
//   merged    fully merged into develop and no open PR uses it as head or base: safe as a group
//   unmerged  everything else, with its last commit date, author, commits ahead and any open PR
import { spawnSync } from "node:child_process";

export const KEPT = ["develop", "mike", "maciej"] as const;
export const MIRRORS = ["prod-app", "staging-app", "prod-landing", "main"] as const;

export type Bucket = "kept" | "mirror" | "merged" | "unmerged";

export interface RemoteBranch {
  name: string;
  sha: string;
  date: string; // YYYY-MM-DD of the last commit
  author: string;
  subject: string;
  merged: boolean; // reachable from the base
  ahead: number; // commits not on the base
}

export interface OpenPr {
  number: number;
  head: string;
  base: string;
  title: string;
}

export interface AuditRow extends RemoteBranch {
  bucket: Bucket;
  prs: string[]; // "#12 (head → develop)" / "#13 (base)"
}

export function classify(branches: RemoteBranch[], prs: OpenPr[]): AuditRow[] {
  return branches
    .map((b): AuditRow => {
      const touching = prs
        .filter((p) => p.head === b.name || p.base === b.name)
        .map((p) =>
          p.head === b.name
            ? `#${p.number} (head → ${p.base})`
            : `#${p.number} (base, from ${p.head})`,
        );
      let bucket: Bucket;
      if ((KEPT as readonly string[]).includes(b.name)) bucket = "kept";
      else if ((MIRRORS as readonly string[]).includes(b.name)) bucket = "mirror";
      else if (b.merged && touching.length === 0) bucket = "merged";
      else bucket = "unmerged";
      return { ...b, bucket, prs: touching };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

const ORDER: Bucket[] = ["kept", "mirror", "merged", "unmerged"];
const TITLES: Record<Bucket, string> = {
  kept: "Kept (long-lived)",
  mirror: "Retired mirror branches (delete one by one, after a yes)",
  merged: "Fully merged into develop, no open PR (safe to delete as a group)",
  unmerged: "Not merged into develop, or used by an open PR (approve one by one)",
};

export function renderText(rows: AuditRow[], base: string): string {
  const out: string[] = [`Remote branches: ${rows.length} (compared with ${base})`];
  for (const bucket of ORDER) {
    const inBucket = rows.filter((r) => r.bucket === bucket);
    out.push("", `## ${TITLES[bucket]}: ${inBucket.length}`);
    for (const r of inBucket) {
      const pr = r.prs.length ? `  PR ${r.prs.join(", ")}` : "";
      const ahead = r.merged ? "merged" : `+${r.ahead}`;
      out.push(`${r.date}  ${r.name}  ${r.author}  ${ahead}${pr}  · ${r.subject}`);
    }
  }
  return out.join("\n");
}

function sh(cmd: string, args: string[]): string {
  const run = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout;
}

function readBranches(base: string): RemoteBranch[] {
  const merged = new Set(
    sh("git", ["for-each-ref", `--merged=${base}`, "--format=%(refname)", "refs/remotes/origin"])
      .split("\n")
      .filter(Boolean),
  );
  const sep = "\x1f";
  const fmt = [
    "%(refname)",
    "%(objectname)",
    "%(committerdate:short)",
    "%(authorname)",
    "%(subject)",
  ].join(sep);
  return sh("git", ["for-each-ref", `--format=${fmt}`, "refs/remotes/origin"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(sep))
    .filter(([ref]) => ref !== "refs/remotes/origin/HEAD")
    .map(([ref, sha, date, author, subject]) => {
      const isMerged = merged.has(ref);
      return {
        name: ref.replace(/^refs\/remotes\/origin\//, ""),
        sha,
        date,
        author,
        subject,
        merged: isMerged,
        ahead: isMerged ? 0 : Number(sh("git", ["rev-list", "--count", `${base}..${sha}`]).trim()),
      };
    });
}

function readOpenPrs(): OpenPr[] {
  const json = sh("gh", [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "1000",
    "--json",
    "number,headRefName,baseRefName,title",
  ]);
  return (
    JSON.parse(json) as {
      number: number;
      headRefName: string;
      baseRefName: string;
      title: string;
    }[]
  ).map((p) => ({
    number: p.number,
    head: p.headRefName,
    base: p.baseRefName,
    title: p.title,
  }));
}

function main(argv: string[]): number {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = value("--base") ?? "origin/develop";
  if (!flag("--no-fetch")) sh("git", ["fetch", "--prune", "--quiet", "origin"]);
  const rows = classify(readBranches(base), readOpenPrs());
  const names = value("--names") as Bucket | undefined;
  if (names) {
    if (!ORDER.includes(names)) {
      console.error(`--names takes one of ${ORDER.join(", ")}`);
      return 1;
    }
    console.log(
      rows
        .filter((r) => r.bucket === names)
        .map((r) => r.name)
        .join("\n"),
    );
  } else if (flag("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(renderText(rows, base));
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
