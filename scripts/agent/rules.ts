import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// HV-10 (specs/harness-v3.md AC28, AC31): path rules live in .claude/rules/,
// each with `paths:`, `incident:` and `expires:` frontmatter; root AGENTS.md
// stays a map of at most 150 lines; and no rule or agent doc names a file or
// `bun run` script that doesn't exist. `bun run lint:rules` (part of verify)
// runs the check; rules.test.ts covers the parts.

export const AGENTS_MAX_LINES = 150;

/** Agent-facing docs whose references are checked, besides every rule. */
export const CHECKED_DOCS = ["AGENTS.md", "CONTRIBUTING.md", "docs/agent-setup.md"];

export type Rule = {
  file: string;
  paths: string[];
  incident?: string;
  expires?: string;
  text: string;
};
export type Problem = { file: string; line: number; reason: string };

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/** The frontmatter keys of a rule; `paths` as a YAML flow list, block list or comma string. */
export function parseFrontmatter(text: string): Record<string, string | string[]> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m?.[1]) return {};
  const out: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of m[1].split("\n")) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item?.[1] && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv?.[1]) continue;
    const [, key, raw = ""] = kv;
    listKey = undefined;
    if (raw === "") {
      out[key] = [];
      listKey = key;
    } else if (raw.startsWith("[")) {
      out[key] = raw
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(unquote)
        .filter(Boolean);
    } else out[key] = unquote(raw);
  }
  return out;
}

export function loadRules(root: string): Rule[] {
  const dir = path.join(root, ".claude/rules");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".md"))
    .toSorted()
    .map((f) => {
      const text = readFileSync(path.join(dir, f), "utf8");
      const fm = parseFrontmatter(text);
      const list = fm.paths;
      const paths = Array.isArray(list) ? list : (list?.split(",").map((p) => p.trim()) ?? []);
      const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : undefined);
      return {
        file: path.posix.join(".claude/rules", f),
        paths,
        incident: str("incident"),
        expires: str("expires"),
        text,
      };
    });
}

/** Claude Code's path globs: `**`, `*`, `?` and `{a,b}`, relative to the project root. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob
        .slice(i + 1, end)
        .split(",")
        .map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&"))
        .join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Frontmatter problems: missing keys, a bad expiry date, a glob that matches no file. */
export function ruleProblems(rule: Rule, files: string[]): Problem[] {
  const problems: Problem[] = [];
  const report = (reason: string) => problems.push({ file: rule.file, line: 1, reason });
  if (rule.paths.length === 0) report("no `paths:` (a rule without paths loads in every session)");
  if (!rule.incident) report("no `incident:` (what went wrong that this rule prevents)");
  if (!rule.expires) report("no `expires:` (the date to review or delete it)");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.expires) || Number.isNaN(Date.parse(rule.expires)))
    report(`\`expires: ${rule.expires}\` is not a YYYY-MM-DD date`);
  for (const glob of rule.paths) {
    const re = globToRegExp(glob);
    if (!files.some((f) => re.test(f))) report(`\`${glob}\` matches no file in the repo`);
  }
  return problems;
}

/** Rules whose `expires:` date has passed (a warning, never a failure: the date can't break an unrelated PR). */
export const expired = (rules: Rule[], today: string) =>
  rules.filter((r) => r.expires && r.expires < today);

export type Ref = { line: number; ref: string; kind: "path" | "script"; cwd?: string };

const PATH_TOKEN = /^\.?[\w@-][\w.@-]*(?:\/[\w.@[\]-]*)+$/;
const SKIP = /[*<>{}$…]|^https?:|^~|^\/\//;

const linkRefs = (raw: string, line: number): Ref[] =>
  [...raw.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => (m[1] ?? "").split("#")[0] ?? "")
    .filter((target) => target && !/^[a-z]+:/.test(target))
    .map((ref) => ({ line, ref, kind: "path" }));

// Code-span paths get a leading `/` so deadRefs resolves them from the repo root.
function spanRefs(span: string, line: number): Ref[] {
  const out: Ref[] = [];
  const run = /^bun run (?:--cwd (\S+) )?([\w:.-]+)/.exec(span);
  if (run?.[2] && !/\.(ts|mjs|js|sh)$/.test(run[2]))
    out.push({ line, ref: run[2], kind: "script", cwd: run[1] });
  for (const token of span.split(/\s+/)) {
    const clean = token.replace(/[),.;]+$/, "").replace(/:\d+$/, "");
    if (PATH_TOKEN.test(clean) && !SKIP.test(clean))
      out.push({ line, ref: `/${clean}`, kind: "path" });
  }
  return out;
}

/** File paths (links and code spans) and `bun run` scripts a markdown doc names, outside fenced blocks. */
export function findRefs(text: string): Ref[] {
  const out: Ref[] = [];
  let fenced = false;
  text.split("\n").forEach((raw, i) => {
    if (/^\s*```/.test(raw)) fenced = !fenced;
    else if (!fenced) {
      out.push(...linkRefs(raw, i + 1));
      for (const m of raw.matchAll(/`([^`]+)`/g)) out.push(...spanRefs(m[1] ?? "", i + 1));
    }
  });
  return out;
}

export type Repo = {
  root: string;
  topLevel: Set<string>;
  exists: (rel: string) => boolean;
  ignored: (rel: string) => boolean;
  scripts: (pkgDir: string) => Set<string> | undefined;
};

/**
 * References in `file` to a path or `bun run` script that doesn't exist. Links
 * resolve from the doc's folder; code spans (marked with a leading `/` by
 * findRefs) from the repo root, and only when their first segment is a
 * top-level entry, so prose like `functions/_shared/` relative to a folder
 * isn't misread. A gitignored path (`docs/local/`) can't be checked in CI, so a
 * code span may name one; a link may not.
 */
export function deadRefs(file: string, text: string, repo: Repo): Problem[] {
  return findRefs(text).flatMap(({ line, ref, kind, cwd }) => {
    const reason = kind === "script" ? missingScript(ref, cwd, repo) : missingPath(file, ref, repo);
    return reason ? [{ file, line, reason }] : [];
  });
}

function missingScript(ref: string, cwd: string | undefined, repo: Repo): string | undefined {
  const scripts = repo.scripts(cwd ?? ".");
  if (scripts && !scripts.has(ref))
    return `\`bun run ${ref}\`: no such script in ${cwd ?? "the root"} package.json`;
  return undefined;
}

function missingPath(file: string, ref: string, repo: Repo): string | undefined {
  const span = ref.startsWith("/");
  if (span && !repo.topLevel.has(ref.slice(1).split("/")[0] ?? "")) return undefined;
  const rel = (
    span ? ref.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), ref))
  ).replace(/\/$/, "");
  // Only a code span may name a local file; a link must reach a committed one
  // (a wrong `../` from .claude/rules lands in the gitignored .claude/).
  if (rel.startsWith("..") || repo.exists(rel) || (span && repo.ignored(rel))) return undefined;
  return `names \`${rel}\`, which doesn't exist`;
}

export function repoAt(root: string): Repo {
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", input });
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
  const topLevel = new Set(files.map((f) => f.split("/")[0] ?? ""));
  const known = new Set(files);
  for (const f of files) {
    for (let i = f.indexOf("/"); i > 0; i = f.indexOf("/", i + 1)) known.add(f.slice(0, i));
  }
  return {
    root,
    topLevel,
    // Tracked or new-but-not-ignored, so local and CI agree (a gitignored file
    // that happens to exist here would pass locally and fail in CI).
    exists: (rel) => known.has(rel),
    // A directory pattern (`docs/local/`) only matches a path inside it when the folder is absent.
    ignored: (rel) =>
      [rel, `${rel}/x`].some((p) => {
        try {
          git(["check-ignore", "-q", "--no-index", p]);
          return true;
        } catch {
          return false;
        }
      }),
    scripts: (pkgDir) => {
      const pkg = path.join(root, pkgDir, "package.json");
      if (!existsSync(pkg)) return undefined;
      return new Set(Object.keys(JSON.parse(readFileSync(pkg, "utf8")).scripts ?? {}));
    },
  };
}

export const trackedFiles = (root: string) =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

/** Every problem in the repo's rules and checked docs. */
export function check(root: string): Problem[] {
  const repo = repoAt(root);
  const files = trackedFiles(root);
  const rules = loadRules(root);
  const problems = rules.flatMap((r) => [
    ...ruleProblems(r, files),
    ...deadRefs(r.file, r.text, repo),
  ]);
  for (const doc of CHECKED_DOCS) {
    if (existsSync(path.join(root, doc)))
      problems.push(...deadRefs(doc, readFileSync(path.join(root, doc), "utf8"), repo));
  }
  const agentsLines = readFileSync(path.join(root, "AGENTS.md"), "utf8")
    .trimEnd()
    .split("\n").length;
  if (agentsLines > AGENTS_MAX_LINES)
    problems.push({
      file: "AGENTS.md",
      line: AGENTS_MAX_LINES + 1,
      reason: `${agentsLines} lines; keep it a map of at most ${AGENTS_MAX_LINES} (move detail into a rule, skill or docs/)`,
    });
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  for (const r of expired(loadRules(root), new Date().toISOString().slice(0, 10)))
    console.warn(
      `warning: ${r.file} expired ${r.expires}: review it, then delete it or move the date`,
    );
  const problems = check(root);
  for (const p of problems) console.error(`${p.file}:${p.line}: ${p.reason}`);
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} problem(s) in rules or agent docs (scripts/agent/rules.ts).`,
    );
    process.exit(1);
  }
  console.log("rules: ok");
}
