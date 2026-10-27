/**
 * Routines (Harness v3, HV-22, specs/harness-v3.md AC35): the four scheduled jobs of the learn
 * loop, their prompts (`.claude/routines/<id>.md`) and the deterministic halves they call.
 *
 *   variant-hunt  nightly, cloud   one escape seed through the variant-hunt skill
 *   retro         weekly, cloud    the week's lessons compiled into checks; stale path rules
 *   prod-watch    daily, cloud     read-only health of production, a Haiku digest to Moduo chat
 *   numbers       weekly, local    `bun run numbers` on Mike's Mac (Entire data lives only there)
 *
 * CLI (`bun run routine <command>`):
 *   list                          the routines, where they run and what they need
 *   body <id> [--env <env_id>]    the RemoteTrigger create body for a cloud routine (prints only)
 *   task <id>                     the create_scheduled_task arguments for a local one (prints only)
 *   seed [--date YYYY-MM-DD]      tonight's escape seed for the variant hunt
 *   watch [--json]                production facts as markdown (GET requests only, writes nothing)
 *   retro-facts [--week Monday]   the week's escapes, new gotchas and decisions, path-rule activity
 *   post <channel> [file]         post markdown (file or stdin) to an existing Moduo chat channel
 *   note <title> [file]           write the weekly retro note under "Harness weekly retro"
 *   bug <seed> <title> [file]     file a confirmed variant as a `bug` task in the Moduo project
 *
 * Nothing here creates a schedule: `body` and `task` print what a person creates (docs/agent-setup.md
 * §Routines). Moduo writes go through the connector with the agent's own key (MODUO_MCP_KEY), and
 * every body passes numbers.ts's `assertPublishable` first: the repo and the workspace are shared.
 * Run with bun (extensionless imports, like numbers.ts).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Rpc } from "./moduo-sync";
import { assertPublishable, isoDay, weekWindow, type Window } from "./numbers";
import { expired, globToRegExp, loadRules, type Rule } from "./rules";

const DAY = 86_400_000;
const ROOT = path.resolve(import.meta.dirname, "../..");
export const REPO = "GrochowskiMichal/Moduo";

// ── Definitions ──────────────────────────────────────────────────────────

export interface Routine {
  id: string;
  /** The name it carries at claude.ai/code/routines or in the desktop app's scheduled tasks. */
  name: string;
  where: "cloud" | "local";
  /** Cloud: 5-field cron in UTC. Local: 5-field cron in the Mac's local time (Europe/Warsaw). */
  cron: string;
  cadence: string;
  /** Cloud only; a local task runs on the app's default model. */
  model?: string;
  /** Cloud only: the session's tool allowlist. */
  allowedTools?: string[];
  /** What has to be in place before it can run. */
  needs: string[];
}

const WRITE_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
const CLOUD_KEY = "MODUO_MCP_KEY in the cloud environment (a dedicated agent key, see §Routines)";

export const ROUTINES: readonly Routine[] = [
  {
    id: "variant-hunt",
    name: "Moduo nightly variant hunt",
    where: "cloud",
    cron: "0 1 * * *",
    cadence: "every night, 01:00 UTC (02:00 Warsaw in winter)",
    model: "claude-opus-5-5",
    allowedTools: WRITE_TOOLS,
    needs: ["the Claude GitHub App on the repo (pushes the proof-test branch)", CLOUD_KEY],
  },
  {
    id: "retro",
    name: "Moduo weekly retro",
    where: "cloud",
    cron: "0 8 * * 1",
    cadence: "Mondays, 08:00 UTC (after the weekly numbers)",
    model: "claude-opus-5-5",
    allowedTools: WRITE_TOOLS,
    needs: ["the Claude GitHub App on the repo (pushes the retro branch)", CLOUD_KEY],
  },
  {
    id: "prod-watch",
    name: "Moduo daily prod watch",
    where: "cloud",
    cron: "0 6 * * *",
    cadence: "every day, 06:00 UTC (07:00 Warsaw in winter)",
    model: "claude-haiku-5-5",
    // Read-only by construction: no file edits, and the only Bash it is told to run is this
    // script's GET-only `watch` and the chat `post`.
    allowedTools: ["Bash", "Read"],
    needs: [
      CLOUD_KEY,
      "network access to app.moduo.app, moduo.app, mcp.moduo.app, *.supabase.co and api.github.com",
      'the Moduo chat channel "prod-watch"',
    ],
  },
  {
    id: "numbers",
    name: "Moduo weekly numbers",
    where: "local",
    cron: "0 7 * * 1",
    cadence: "Mondays, 07:00 Warsaw, on Mike's Mac (runs on next app launch if it was closed)",
    needs: [
      "MODUO_MCP_KEY in the desktop app's environment (Notes at Edit)",
      "`gh` signed in",
      "the Entire checkpoint refs in the main checkout (Mike's Mac only)",
    ],
  },
];

export function routine(id: string): Routine {
  const r = ROUTINES.find((x) => x.id === id);
  if (!r)
    throw new Error(`unknown routine "${id}" (one of: ${ROUTINES.map((x) => x.id).join(", ")})`);
  return r;
}

export function promptPath(id: string): string {
  return path.join(".claude/routines", `${id}.md`);
}

export function readPrompt(id: string, root = ROOT): string {
  return readFileSync(path.join(root, promptPath(id)), "utf8").trim();
}

/** The cloud environment the routines run in (claude.ai/code, "Default"). */
export const DEFAULT_ENVIRONMENT = "env_01DmttT8SZMoKz7TE3PBtA8f";

/** The body for RemoteTrigger `create` (the /schedule skill's shape). Prints; never sends. */
export function createBody(
  r: Routine,
  prompt: string,
  opts: { environmentId?: string; uuid?: string } = {},
): Record<string, unknown> {
  if (r.where !== "cloud") throw new Error(`${r.id} runs locally: use \`task ${r.id}\``);
  return {
    name: r.name,
    cron_expression: r.cron,
    enabled: true,
    job_config: {
      ccr: {
        environment_id: opts.environmentId ?? DEFAULT_ENVIRONMENT,
        session_context: {
          model: r.model,
          sources: [{ git_repository: { url: `https://github.com/${REPO}` } }],
          allowed_tools: r.allowedTools,
        },
        events: [
          {
            data: {
              uuid: opts.uuid ?? crypto.randomUUID(),
              session_id: "",
              type: "user",
              parent_tool_use_id: null,
              message: { content: prompt, role: "user" },
            },
          },
        ],
      },
    },
  };
}

/** The arguments for the desktop app's create_scheduled_task. Prints; never sends. */
export function localTask(r: Routine, prompt: string): Record<string, unknown> {
  if (r.where !== "local") throw new Error(`${r.id} runs in the cloud: use \`body ${r.id}\``);
  return {
    taskId: `moduo-${r.id}`,
    title: r.name,
    description: r.cadence,
    cronExpression: r.cron,
    prompt,
  };
}

// ── Variant hunt: the seed ───────────────────────────────────────────────

export interface Escape {
  id: string;
  /** When escape.json first landed (ISO), or null when git doesn't know. */
  addedAt: string | null;
}

/**
 * Tonight's seed: an escape added in the last two days goes first (newest first, so a fresh fix
 * is hunted the night after it lands); otherwise the escapes take turns by UTC day number.
 */
export function pickSeed(escapes: readonly Escape[], now: Date): Escape | null {
  if (escapes.length === 0) return null;
  const fresh = escapes
    .filter((e) => e.addedAt && now.getTime() - Date.parse(e.addedAt) < 2 * DAY)
    .toSorted((a, b) => Date.parse(b.addedAt!) - Date.parse(a.addedAt!));
  if (fresh[0]) return fresh[0];
  const sorted = escapes.toSorted((a, b) => a.id.localeCompare(b.id));
  return sorted[Math.floor(now.getTime() / DAY) % sorted.length]!;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
}

export function listEscapes(root = ROOT): Escape[] {
  const dir = path.join(root, "benchmarks/escapes");
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "escape.json")))
    .map((d) => {
      const added = git([
        "log",
        "--diff-filter=A",
        "--format=%cI",
        "--",
        `benchmarks/escapes/${d.name}/escape.json`,
      ])
        .trim()
        .split("\n")
        .pop();
      return { id: d.name, addedAt: added || null };
    });
}

// ── Prod watch ───────────────────────────────────────────────────────────

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WorkflowRun {
  name: string;
  event: string;
  head_branch: string | null;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

export interface WatchFacts {
  at: string;
  release: { tag: string; sha: string } | null;
  checks: Check[];
  failedRuns: WorkflowRun[];
}

const SHARED = new Set(["develop", "mike", "maciej"]);
const RED = new Set(["failure", "timed_out", "startup_failure"]);

/** Red runs that concern production or a shared branch: not a task branch's own CI. */
export function prodRelevantFailures(runs: readonly WorkflowRun[]): WorkflowRun[] {
  return runs.filter(
    (r) =>
      RED.has(r.conclusion ?? "") &&
      (SHARED.has(r.head_branch ?? "") ||
        /^v\d+\.\d+\.\d+$/.test(r.head_branch ?? "") ||
        ["schedule", "release", "workflow_dispatch"].includes(r.event)),
  );
}

export function watchStatus(f: WatchFacts): "ok" | "attention" {
  return f.checks.every((c) => c.ok) && f.failedRuns.length === 0 ? "ok" : "attention";
}

/** One table cell: backslashes and pipes escaped, line breaks flattened, so a detail can't end its row. */
export function cell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\s*[\r\n]+\s*/g, " ");
}

export function renderWatch(f: WatchFacts): string {
  const status = watchStatus(f);
  const lines = [
    `**Prod watch · ${f.at.slice(0, 16).replace("T", " ")} UTC · ${status === "ok" ? "all clear" : "needs a look"}**`,
    "",
    `Release: ${f.release ? `${f.release.tag} (${f.release.sha.slice(0, 7)})` : "no vX.Y.Z tag found"}`,
    "",
    "| | Check | Result |",
    "| --- | --- | --- |",
    ...f.checks.map((c) => `| ${c.ok ? "✅" : "❌"} | ${c.name} | ${cell(c.detail)} |`),
    "",
  ];
  if (f.failedRuns.length === 0)
    lines.push("No red workflow runs on shared branches, tags or schedules in the last 24 h.");
  else {
    lines.push(`Red workflow runs in the last 24 h (${f.failedRuns.length}):`);
    for (const r of f.failedRuns)
      lines.push(
        `- ${r.name} · ${r.event} · ${r.head_branch ?? "?"} · ${r.conclusion}: ${r.html_url}`,
      );
  }
  return lines.join("\n");
}

type Fetch = typeof fetch;

async function timed(name: string, run: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The latest vX.Y.Z tag on the remote and the commit it points at. */
export function latestRelease(lsRemote: string): { tag: string; sha: string } | null {
  const peeled = new Map<string, string>();
  const plain = new Map<string, string>();
  for (const line of lsRemote.split("\n")) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/.exec(line.trim());
    if (m) (m[3] ? peeled : plain).set(m[2]!, m[1]!);
  }
  const tags = [...new Set([...plain.keys(), ...peeled.keys()])];
  if (tags.length === 0) return null;
  const num = (t: string) => t.slice(1).split(".").map(Number);
  tags.sort((a, b) => {
    const [x, y] = [num(a), num(b)];
    return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!;
  });
  const tag = tags[0]!;
  return { tag, sha: peeled.get(tag) ?? plain.get(tag)! };
}

/** "build X = vY" when the app serves the release's commit; throws (a failed check) otherwise. */
export function buildMatches(
  build: string | undefined,
  release: { tag: string; sha: string } | null,
): string {
  if (!build) throw new Error("config.json has no build");
  if (!release) return `build ${build} (no release tag to compare)`;
  if (!release.sha.startsWith(build))
    throw new Error(`build ${build}, but ${release.tag} is ${release.sha.slice(0, 7)}`);
  return `build ${build} = ${release.tag}`;
}

/** Every production fact the watch reads. GET (and one keyless POST probe), never a write. */
export async function gatherWatch(fetchFn: Fetch = fetch, now = new Date()): Promise<WatchFacts> {
  const { smoke, smokeLanding } = await import("../smoke-hosting");
  let release: WatchFacts["release"] = null;
  try {
    release = latestRelease(git(["ls-remote", "--tags", `https://github.com/${REPO}.git`, "v*"]));
  } catch {
    release = null;
  }
  const checks: Check[] = [];
  const expect = release ? { build: release.sha.slice(0, 7) } : undefined;
  const app = await smoke("https://app.moduo.app", { expect }).catch((err: unknown) => [
    { name: "app smoke", ok: false, detail: String(err) },
  ]);
  checks.push(...app.map((c) => ({ ...c, name: `app · ${c.name}` })));
  const landing = await smokeLanding("https://moduo.app", "prod").catch((err: unknown) => [
    { name: "landing smoke", ok: false, detail: String(err) },
  ]);
  checks.push(...landing.map((c) => ({ ...c, name: `landing · ${c.name}` })));

  checks.push(
    await timed("MCP connector answers", async () => {
      // Keyless: any answer under 500 (401 is the expected one) means the Worker and function are up.
      const res = await fetchFn("https://mcp.moduo.app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return `HTTP ${res.status}`;
    }),
  );
  let cfg: { supabaseUrl?: string; supabasePublishableKey?: string; build?: string } = {};
  checks.push(
    await timed("app is on the latest release", async () => {
      cfg = (await (
        await fetchFn("https://app.moduo.app/config.json", { signal: AbortSignal.timeout(15_000) })
      ).json()) as typeof cfg;
      return buildMatches(cfg.build, release);
    }),
  );
  checks.push(
    await timed("Supabase auth health", async () => {
      if (!cfg.supabaseUrl || !cfg.supabasePublishableKey)
        throw new Error("config.json has no Supabase URL");
      const res = await fetchFn(`${cfg.supabaseUrl}/auth/v1/health`, {
        headers: { apikey: cfg.supabasePublishableKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return "HTTP 200";
    }),
  );

  let failedRuns: WorkflowRun[] = [];
  const since = new Date(now.getTime() - DAY).toISOString();
  const runs = await timed("GitHub Actions readable", async () => {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const all: WorkflowRun[] = [];
    // A busy day is several pages; five (500 runs) stays far inside the keyless rate limit.
    for (let page = 1; page <= 5; page++) {
      const res = await fetchFn(
        `https://api.github.com/repos/${REPO}/actions/runs?per_page=100&page=${page}&created=%3E%3D${since}`,
        { headers, signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const batch = ((await res.json()) as { workflow_runs?: WorkflowRun[] }).workflow_runs ?? [];
      all.push(...batch);
      if (batch.length < 100) break;
    }
    failedRuns = prodRelevantFailures(all);
    return `${all.length} runs in 24 h`;
  });
  checks.push(runs);
  return { at: now.toISOString(), release, checks, failedRuns };
}

// ── Retro facts ──────────────────────────────────────────────────────────

export interface RuleActivity {
  file: string;
  expires?: string;
  expired: boolean;
  /** Commits in the last 30 days that changed a file the rule's `paths:` match. */
  touched: number;
  /** Commit messages in the last 30 days that name the rule's file. */
  cited: number;
}

/**
 * Path-rule activity over 30 days. A rule whose paths no commit touched and that no commit cites
 * can't have been loaded by an edit or used in a fix: the retro proposes deleting it unless a
 * person renews `expires:` (specs/harness-v3.md §Knowledge).
 */
export function ruleActivity(
  rules: readonly Rule[],
  commits: readonly { message: string; files: string[] }[],
  today: string,
): RuleActivity[] {
  const old = new Set(expired([...rules], today).map((r) => r.file));
  return rules.map((r) => {
    const res = r.paths.map(globToRegExp);
    const base = path.basename(r.file);
    return {
      file: r.file,
      expires: r.expires,
      expired: old.has(r.file),
      touched: commits.filter((c) => c.files.some((f) => res.some((re) => re.test(f)))).length,
      cited: commits.filter((c) => c.message.includes(base)).length,
    };
  });
}

export const isStale = (a: RuleActivity) => a.touched === 0 && a.cited === 0;

/** The bold lead of each `- **…**` entry a diff adds; an entry it also removes only moved. */
export function addedEntries(diff: string): string[] {
  const lead = (sign: string) =>
    diff
      .split("\n")
      .filter((l) => l.startsWith(`${sign}- **`))
      .map((l) => /\*\*(.+?)\*\*/.exec(l)?.[1])
      .filter((t): t is string => Boolean(t));
  const removed = new Set(lead("-"));
  return [...new Set(lead("+"))].filter((t) => !removed.has(t));
}

/** `git log --name-only --format=%x00%B%x01` → commits with their message and files. */
export function parseLog(raw: string): { message: string; files: string[] }[] {
  return raw
    .split("\0")
    .slice(1)
    .map((chunk) => {
      const [message = "", files = ""] = chunk.split("\x01");
      return {
        message: message.trim(),
        files: files
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
      };
    });
}

export interface RetroFacts {
  window: Window;
  escapes: Escape[];
  gotchas: string[];
  decisions: string[];
  rules: RuleActivity[];
}

export function renderRetroFacts(f: RetroFacts): string {
  const span = `${isoDay(f.window.start)} → ${isoDay(new Date(f.window.end.getTime() - DAY))}`;
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`) : ["- none"]);
  return [
    `# Retro facts · ${span}`,
    "",
    `## Escapes added (${f.escapes.length})`,
    ...list(f.escapes.map((e) => `benchmarks/escapes/${e.id}`)),
    "",
    `## Gotchas added (${f.gotchas.length})`,
    ...list(f.gotchas),
    "",
    `## Decisions added (${f.decisions.length})`,
    ...list(f.decisions),
    "",
    "## Path rules (last 30 days)",
    "",
    "| Rule | Expires | Commits touching its paths | Commits citing it | Verdict |",
    "| --- | --- | --- | --- | --- |",
    ...f.rules.map(
      (r) =>
        `| ${r.file} | ${r.expires ?? "?"} | ${r.touched} | ${r.cited} | ${
          r.expired
            ? "expired: renew or delete"
            : isStale(r)
              ? "stale: delete unless renewed"
              : "in use"
        } |`,
    ),
  ].join("\n");
}

/** HEAD's first-parent commit as of `when` (the shared branch's state then), or the empty tree. */
function headAt(when: Date): string {
  const sha = git([
    "rev-list",
    "-1",
    "--first-parent",
    `--before=${when.toISOString()}`,
    "HEAD",
  ]).trim();
  return sha || git(["hash-object", "-t", "tree", "/dev/null"]).trim();
}

export function gatherRetro(w: Window, now = new Date(), root = ROOT): RetroFacts {
  // A diff between the branch's state at both ends, not `git log -p`: merges replay one entry
  // once per branch it travelled through.
  const [from, to] = [headAt(w.start), headAt(w.end)];
  const added = new Set(
    git(["diff", "--diff-filter=A", "--name-only", from, to, "--", "benchmarks/escapes"])
      .split("\n")
      .map((f) => /^benchmarks\/escapes\/([^/]+)\/escape\.json$/.exec(f)?.[1])
      .filter(Boolean),
  );
  const escapes = listEscapes(root).filter((e) => added.has(e.id));
  const diff = (dir: string) => git(["diff", from, to, "--", dir]);
  const month = parseLog(
    git([
      "log",
      "--since",
      new Date(now.getTime() - 30 * DAY).toISOString(),
      "--name-only",
      "--format=%x00%B%x01",
    ]),
  );
  return {
    window: w,
    escapes,
    gotchas: addedEntries(diff("docs/gotchas")),
    decisions: addedEntries(diff("docs/decisions")),
    rules: ruleActivity(loadRules(root), month, isoDay(now)),
  };
}

// ── Moduo writes ─────────────────────────────────────────────────────────

export const RETRO_PARENT = {
  title: "Harness weekly retro",
  intro:
    "One child note per week: what the weekly retro routine (specs/harness-v3.md HV-22) compiled into checks, and the path rules it proposes to delete.",
};

interface Channel {
  id: string;
  name: string;
  archived?: boolean;
}

/** Posts to a channel that already exists; never creates one (a person names the channels). */
export async function postToChannel(rpc: Rpc, channel: string, text: string): Promise<string> {
  assertPublishable(text);
  if (text.length > 8000) throw new Error(`message is ${text.length} characters; chat takes 8,000`);
  const rows = (await rpc("chat_list_channels", {})) as Channel[];
  const hit = rows.find((c) => c.name === channel && !c.archived);
  if (!hit) throw new Error(`no chat channel "${channel}" this key can read; a person creates it`);
  await rpc("chat_post", { channel: hit.id, text });
  return hit.id;
}

interface Project {
  id: string;
  name: string;
}

/** A confirmed variant as a `bug` task in the Moduo project; a re-run updates the same task. */
export async function fileBug(
  rpc: Rpc,
  seed: string,
  title: string,
  description: string,
): Promise<string> {
  assertPublishable(`${title}\n${description}`);
  const projects = (await rpc("projects_list", {})) as Project[];
  const moduo = projects.find((p) => p.name === "Moduo");
  if (!moduo) throw new Error('no "Moduo" project this key can see');
  const task = (await rpc("tasks_create", {
    title,
    description,
    project_id: moduo.id,
    tags: ["bug", "variant-hunt"],
    imported_from: { source: "variant-hunt", key: `${seed}:${title}`.slice(0, 200) },
  })) as { handle?: string; id: string };
  return task.handle ?? task.id;
}

// ── CLI ──────────────────────────────────────────────────────────────────

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function readBody(file: string | undefined): Promise<string> {
  if (file) return readFileSync(file, "utf8");
  return await new Response(Bun.stdin.stream()).text();
}

async function moduo(): Promise<Rpc> {
  const key = process.env.MODUO_MCP_KEY ?? "";
  if (!key)
    throw new Error("MODUO_MCP_KEY is not set (the agent's own Moduo key); nothing was written.");
  const { connectorRpc } = await import("./moduo-sync");
  return connectorRpc(process.env.MODUO_MCP_URL || "https://mcp.moduo.app", key);
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** The CLI's commands; the routine prompts may name only these (routines.test.ts). */
export const COMMANDS: Record<string, (rest: string[]) => Promise<void>> = {
  list: async () => {
    for (const r of ROUTINES)
      console.log(
        `${r.id.padEnd(13)} ${r.where.padEnd(6)} ${r.cron.padEnd(11)} ${r.model ?? "app default"}\n  ${r.name} · ${r.cadence}\n  needs: ${r.needs.join("; ")}`,
      );
  },
  body: async (rest) => {
    const r = routine(rest[0] ?? "");
    print(createBody(r, readPrompt(r.id), { environmentId: flag(rest, "--env") }));
  },
  task: async (rest) => {
    const r = routine(rest[0] ?? "");
    print(localTask(r, readPrompt(r.id)));
  },
  seed: async (rest) => {
    const date = flag(rest, "--date");
    const seed = pickSeed(listEscapes(), date ? new Date(`${date}T01:00:00Z`) : new Date());
    if (!seed) throw new Error("no escapes in benchmarks/escapes");
    console.log(seed.id);
  },
  watch: async (rest) => {
    const facts = await gatherWatch();
    if (rest.includes("--json")) print(facts);
    else console.log(renderWatch(facts));
  },
  "retro-facts": async (rest) => {
    console.log(renderRetroFacts(gatherRetro(weekWindow(new Date(), flag(rest, "--week")))));
  },
  post: async ([channel, file]) => {
    if (!channel) throw new Error("post needs a channel name");
    const id = await postToChannel(await moduo(), channel, (await readBody(file)).trim());
    console.log(`routine: posted to #${channel} (${id})`);
  },
  note: async ([title, file]) => {
    if (!title) throw new Error("note needs a title");
    const { writeNote } = await import("./numbers");
    const body = (await readBody(file)).trim();
    const done = await writeNote(await moduo(), title, body, RETRO_PARENT);
    console.log(`routine: note ${done.action} in Moduo: "${title}" (${done.id})`);
  },
  bug: async ([seed, title, file]) => {
    if (!seed || !title) throw new Error("bug needs a seed and a title");
    console.log(await fileBug(await moduo(), seed, title, (await readBody(file)).trim()));
  },
};

/** A command by name; never an inherited property such as `constructor` or `__proto__`. */
export function commandFor(cmd: string): ((rest: string[]) => Promise<void>) | undefined {
  return Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
}

async function main([cmd, ...rest]: string[]): Promise<void> {
  const run = cmd ? commandFor(cmd) : undefined;
  if (!run)
    throw new Error(
      "usage: bun run routine list | body <id> | task <id> | seed | watch | retro-facts | post <channel> [file] | note <title> [file] | bug <seed> <title> [file]",
    );
  await run(rest);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`routine: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
