/**
 * The review tier of a change, from the paths it touches (HV-5, specs/harness-v3.md AC19).
 * This file holds the one Tier 2 path list: CI labels PRs from it (pr-tier.yml) and
 * `/s2`/`/s3` run it instead of deciding the tier themselves.
 *
 *   tier-0  docs only: Markdown anywhere, non-code files under docs/ and specs/
 *           (the same rule as checks.yml's docs-only skip)
 *   tier-1  everything else
 *   tier-2  any path on TIER2 below: the validator subagent reviews the diff before merging
 *
 * Renames count as a delete plus an add, so moving a file off a Tier 2 path is Tier 2.
 * Written in erasable TypeScript only, so `node` (type stripping) and `bun` both run it.
 *
 * CLI:
 *   bun scripts/ci/tier.ts [<base>]          this branch against <base> (default origin/develop),
 *                                            committed, uncommitted and untracked files
 *   bun scripts/ci/tier.ts --range A...B     a commit range only (CI)
 *   bun scripts/ci/tier.ts --files a b …     the given paths
 * Prints `tier-N` on the first line, then each Tier 2 path with the rule it matched.
 * Add `--json` for `{ tier, matches }`.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type Tier = 0 | 1 | 2;

export interface Tier2Rule {
  glob: string;
  why: string;
}

/** The Tier 2 path list. `**` matches any depth, `*` anything within one path segment. */
export const TIER2: readonly Tier2Rule[] = [
  { glob: "supabase/migrations/**", why: "migrations" },
  { glob: "supabase/tests/**", why: "RLS/policy tests" },
  { glob: "supabase/functions/_shared/contracts/**", why: "contracts" },
  { glob: "supabase/functions/delete-account/**", why: "delete-account" },
  { glob: "supabase/functions/_shared/account-erasure.ts", why: "delete-account" },
  { glob: "supabase/functions/_shared/posthog-erasure.ts", why: "delete-account" },
  { glob: "supabase/functions/_shared/app-token.ts", why: "auth (app tokens)" },
  { glob: "supabase/functions/_shared/secret-keys.ts", why: "auth (secret keys)" },
  { glob: "supabase/functions/_shared/token-cipher.ts", why: "auth (token encryption)" },
  { glob: "supabase/config.toml", why: "auth settings" },
  { glob: "supabase/functions/_shared/billing.ts", why: "billing" },
  { glob: "supabase/functions/create-checkout-session/**", why: "billing" },
  { glob: "supabase/functions/create-portal-session/**", why: "billing" },
  { glob: "supabase/functions/start-trial/**", why: "billing" },
  { glob: "supabase/functions/extend-trial/**", why: "billing" },
  { glob: "supabase/functions/issue-founder-coupon/**", why: "billing" },
  { glob: "supabase/functions/moduo-mcp/**", why: "moduo-mcp" },
  { glob: "infra/mcp-proxy/**", why: "mcp-proxy" },
  { glob: "supabase/functions/meet-*/**", why: "meet" },
  { glob: "apps/app/src/lib/runtime*", why: "runtime" },
  { glob: "apps/app/src/lib/sync/**", why: "sync kernel" },
  { glob: "apps/app/src/lib/prefs-sync.ts", why: "prefs sync" },
  { glob: "apps/app/src/providers/auth-provider.tsx", why: "auth provider" },
  { glob: "apps/desktop/src-tauri/src/store*/**", why: "desktop stores" },
  { glob: "apps/desktop/src-tauri/src/auth.rs", why: "desktop auth" },
  { glob: "apps/desktop/src-tauri/src/keychain.rs", why: "desktop auth" },
  { glob: "apps/desktop/src-tauri/capabilities/**", why: "Tauri permissions" },
  { glob: "apps/desktop/src-tauri/tauri.conf.json", why: "updater/signing" },
  { glob: "apps/app/src/lib/tauri-plugin-updater-stub.ts", why: "updater/signing" },
  { glob: "infra/update-server/**", why: "updater/signing" },
  { glob: "scripts/tauri-signed-build.sh", why: "updater/signing" },
  { glob: "scripts/ci-normalize-updater-key.sh", why: "updater/signing" },
  { glob: "scripts/ci-macos-notarize.sh", why: "updater/signing" },
  { glob: ".github/workflows/**", why: "workflows" },
  { glob: "scripts/ci/**", why: "CI gates (this list, ratchets, weakening detector)" },
  { glob: ".claude/hooks/guard-*", why: "agent guards" },
  { glob: ".claude/settings.json", why: "agent permissions" },
];

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `dir/**` matches everything below dir; `**/` matches zero or more directories.
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

const TIER2_RES = TIER2.map((rule) => ({ rule, re: globToRegExp(rule.glob) }));

export function tier2RuleFor(path: string): Tier2Rule | null {
  return TIER2_RES.find(({ re }) => re.test(path))?.rule ?? null;
}

/** Docs-only files: the rule checks.yml uses to skip lint and tests on a docs-only PR. */
export function isDocsOnly(path: string): boolean {
  if (path.startsWith(".changes/") || path.startsWith("release-notes/")) return false;
  if (path === "CHANGELOG.md") return false;
  if (path.endsWith(".md")) return true;
  if (path.startsWith("docs/") || path.startsWith("specs/")) {
    return !/\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|json|jsonc)$/.test(path);
  }
  return false;
}

export function tierOf(path: string): Tier {
  if (tier2RuleFor(path)) return 2;
  return isDocsOnly(path) ? 0 : 1;
}

export interface TierResult {
  tier: Tier;
  /** Every Tier 2 path with the rule that matched it. */
  matches: { path: string; glob: string; why: string }[];
}

/** The tier of a whole change: the highest tier of its paths; no paths is tier-0. */
export function classify(paths: readonly string[]): TierResult {
  let tier: Tier = 0;
  const matches: TierResult["matches"] = [];
  for (const path of new Set(paths.filter(Boolean))) {
    const rule = tier2RuleFor(path);
    if (rule) matches.push({ path, glob: rule.glob, why: rule.why });
    const t = tierOf(path);
    if (t > tier) tier = t;
  }
  return { tier, matches };
}

function git(args: string[]): string[] {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function changedPaths(argv: string[]): string[] {
  const filesAt = argv.indexOf("--files");
  if (filesAt >= 0) return argv.slice(filesAt + 1).filter((a) => !a.startsWith("--"));
  const rangeAt = argv.indexOf("--range");
  if (rangeAt >= 0) {
    const range = argv[rangeAt + 1];
    if (!range) throw new Error("--range needs A...B");
    return git(["diff", "--name-only", "--no-renames", range]);
  }
  const base = argv.find((a) => !a.startsWith("--")) ?? "origin/develop";
  const [mergeBase] = git(["merge-base", base, "HEAD"]);
  // Against the merge base, not HEAD: committed and uncommitted changes together.
  return [
    ...git(["diff", "--name-only", "--no-renames", mergeBase]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const result = classify(changedPaths(argv));
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`tier-${result.tier}`);
    for (const m of result.matches) console.log(`  ${m.path}  (${m.why}: ${m.glob})`);
  }
}
