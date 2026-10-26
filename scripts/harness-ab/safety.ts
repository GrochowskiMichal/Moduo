// What the A/B rig refuses (specs/harness-v3.md, AC33): a run never reaches the shared local
// Supabase stack, production (the app, its Supabase project, the Moduo MCP) or a git remote.
// Three layers: the config is checked before anything runs (refuseConfig), the sandbox profile is
// derived from the lane profile with only the model API and the package registry left open
// (rigProfile) and run through srt-offline.mjs, which closes the stack's ports on localhost, and the agent gets a scrubbed environment (agentEnv). The workspace itself is a
// clone with no remote (checked by refuseWorkspace before the agent starts).

export type Refusal = { where: string; reason: string };

export class RefusedError extends Error {
  constructor(readonly refusals: Refusal[]) {
    super(
      `harness-ab refused the run:\n${refusals.map((r) => `  - ${r.where}: ${r.reason}`).join("\n")}`,
    );
  }
}

/** Patterns that point at the shared stack, production or a remote, with the reason shown. */
export const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(127\.0\.0\.1|localhost|0\.0\.0\.0|host\.docker\.internal):5432\d\b/i,
    reason: "the shared local Supabase stack (ports 54321-54329)",
  },
  { pattern: /\bsupabase\.(co|com|in)\b/i, reason: "a hosted Supabase project (prod)" },
  { pattern: /\bmoduo\.app\b/i, reason: "production Moduo (the app or mcp.moduo.app)" },
  {
    pattern: /\b(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org)\b/i,
    reason: "a git remote host",
  },
  { pattern: /\bgit@[\w.-]+:|\bssh:\/\/|https?:\/\/\S+\.git\b/i, reason: "a git remote URL" },
  { pattern: /\bgit\s+push\b|\bgh\s+(pr|api|release|workflow)\b/, reason: "a write to a remote" },
];

/** The only hosts a rig run may reach: the model API (Anthropic only) and the npm registry. */
export const ALLOWED_HOSTS = [
  "api.anthropic.com",
  "claude.ai",
  "platform.claude.com",
  "console.anthropic.com",
  "statsig.anthropic.com",
  "registry.npmjs.org",
];

/** Claude flags an arm may not pass: the rig owns MCP, settings, permissions and the workspace. */
export const RESERVED_FLAGS = [
  "--mcp-config",
  "--strict-mcp-config",
  "--settings",
  "--setting-sources",
  "--permission-mode",
  "--dangerously-skip-permissions",
  "--add-dir",
  "--output-format",
  "--model",
  "--effort",
  "-p",
  "--print",
  "--resume",
  "--continue",
  "-c",
  "-r",
];

/** Anthropic models only (AGENTS.md): an alias or a claude-* model ID. */
export const isAnthropicModel = (model: string) =>
  /^(opus|sonnet|haiku|fable|opusplan|default)(\[1m\])?$/.test(model) ||
  /^claude-[a-z0-9.-]+$/.test(model);

const strings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  return out;
};

/** Every string in `value` (keys included) checked against FORBIDDEN. */
export function scan(where: string, value: unknown): Refusal[] {
  const out: Refusal[] = [];
  for (const s of strings(value))
    for (const { pattern, reason } of FORBIDDEN)
      if (pattern.test(s)) out.push({ where, reason: `${reason}: "${s.slice(0, 80)}"` });
  return out;
}

export type ArmLike = {
  id: string;
  model: string;
  args?: string[];
  env?: Record<string, string>;
  network?: string[];
  settings?: Record<string, unknown>;
  promptPrefix?: string;
  promptSuffix?: string;
  appendSystemPrompt?: string;
};

export function refuseArm(arm: ArmLike): Refusal[] {
  const where = `arm ${arm.id}`;
  const out = scan(where, arm);
  if (!isAnthropicModel(arm.model))
    out.push({ where, reason: `"${arm.model}" is not an Anthropic model (Anthropic only)` });
  for (const a of arm.args ?? []) {
    const flag = a.split("=")[0] ?? a;
    if (RESERVED_FLAGS.includes(flag))
      out.push({ where, reason: `${flag} is set by the rig, not by an arm` });
  }
  for (const host of arm.network ?? [])
    if (/^(127\.|localhost|0\.0\.0\.0|\[?::1)/i.test(host))
      out.push({ where, reason: `${host}: a local service is shared with other sessions` });
  const servers = (arm.settings as { mcpServers?: unknown } | undefined)?.mcpServers;
  if (servers) out.push({ where, reason: "an arm can't add MCP servers (strict MCP config)" });
  return out;
}

export type TaskLike = { id: string; prompt: string; oracle: unknown; verify?: unknown };

export function refuseTask(task: TaskLike): Refusal[] {
  return scan(`task ${task.id}`, { prompt: task.prompt, oracle: task.oracle, verify: task.verify });
}

/** The repository the clone comes from must be a local path, never a URL. */
export function refuseSource(repo: string): Refusal[] {
  return /^[a-z+]+:\/\/|^git@|^[\w.-]+:[^/]/i.test(repo)
    ? [{ where: "source", reason: `${repo} is a remote; the rig clones a local repository only` }]
    : [];
}

/** After cloning: the workspace has no remote and is not the source checkout. */
export function refuseWorkspace(ws: { dir: string; source: string; remotes: string[] }) {
  const out: Refusal[] = [];
  if (ws.remotes.length > 0)
    out.push({ where: "workspace", reason: `has remotes (${ws.remotes.join(", ")})` });
  if (ws.dir === ws.source || ws.dir.startsWith(`${ws.source}/`))
    out.push({ where: "workspace", reason: "is inside the source checkout" });
  return out;
}

export type SrtProfile = {
  network: { allowedDomains: string[]; deniedDomains?: string[]; allowLocalBinding?: boolean };
  filesystem: { denyRead: string[]; allowWrite: string[]; denyWrite: string[] };
  [k: string]: unknown;
};

/**
 * The lane profile with the network cut to ALLOWED_HOSTS (plus an arm's extra hosts, already
 * checked), no local ports, and the source checkout's env files and credential stores unreadable.
 */
export function rigProfile(lane: SrtProfile, opts: { source: string; extraHosts?: string[] }) {
  const keep = new Set([...ALLOWED_HOSTS, ...(opts.extraHosts ?? [])]);
  const profile: SrtProfile = {
    ...lane,
    $comment:
      "Generated by scripts/harness-ab/safety.ts from .claude/sandbox/lane.srt.json: model API and npm only.",
    network: {
      ...lane.network,
      allowedDomains: [...keep],
      // Tests bind local ports (rstest probes one); srt-offline.mjs closes the stack's ports instead.
      allowLocalBinding: true,
    },
    filesystem: {
      ...lane.filesystem,
      denyRead: [
        ...lane.filesystem.denyRead,
        `${opts.source}/.env`,
        `${opts.source}/.env.local`,
        `${opts.source}/.env.cloud.local`,
        `${opts.source}/.claude/settings.local.json`,
        "~/.config/gh",
        "~/.git-credentials",
        "~/.netrc",
        "~/.supabase",
        "~/.wrangler",
        "~/Library/Preferences/.wrangler",
      ],
    },
  };
  const left = scan("sandbox profile", profile.network.allowedDomains);
  if (left.length > 0) throw new RefusedError(left);
  return profile;
}

/** Environment variables a run inherits; everything else (keys, Supabase URLs, tokens) is dropped. */
export const ENV_ALLOW = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "TERM",
  "TZ",
  "BUN_INSTALL",
  "NVM_DIR",
  // Model auth, when a founder uses a token instead of the Keychain login.
  "CLAUDE_CODE_OAUTH_TOKEN",
];

export function agentEnv(from: NodeJS.ProcessEnv, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(from))
    if (v !== undefined && (ENV_ALLOW.includes(k) || k.startsWith("LC_"))) env[k] = v;
  return { ...env, ...extra };
}

/** The shared stack's ports; the MCP eval's own stack (mcp-eval/stack.ts) lives outside them. */
export const SHARED_STACK_PORTS = { from: 54320, to: 54329 };

/**
 * The one MCP server a rig run may get (HV-29): the connector on the eval's own local stack,
 * `http://127.0.0.1:<port>/functions/v1/moduo-mcp`, on a port outside the shared stack's. Never
 * production, a hosted project or the shared stack; everything else in this file still applies.
 */
export function refuseMcpTarget(url: string): Refusal[] {
  const where = "mcp target";
  const m = url.match(/^http:\/\/127\.0\.0\.1:(\d{2,5})\/functions\/v1\/moduo-mcp$/);
  const out = scan(where, url);
  if (!m) out.push({ where, reason: `${url} is not a local moduo-mcp URL on 127.0.0.1` });
  else {
    const port = Number(m[1]);
    if (port >= SHARED_STACK_PORTS.from && port <= SHARED_STACK_PORTS.to)
      out.push({ where, reason: `port ${port} is the shared local Supabase stack's` });
  }
  return out;
}
