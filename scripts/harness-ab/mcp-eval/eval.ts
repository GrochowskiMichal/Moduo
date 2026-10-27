// The MCP agent-experience eval (specs/harness-v3.md, HV-29, AC38): 15 user tasks × N runs of a
// Claude agent whose only tools are the Moduo connector, on the eval's own Supabase stack (never
// the shared stack or production). One JSON row per run: success, wrong-tool calls, tool errors,
// turns, tokens and time. README.md here has the commands and the definitions.
//
//   bun run mcp-eval up                      # start the eval stack (≈1 min)
//   bun run mcp-eval check-tasks             # no model: oracle fails before, passes after the reference
//   bun run mcp-eval run --repeats 5 [--model sonnet] [--effort low] [--tasks 01-…,02-…] [--parallel 3]
//   bun run mcp-eval report <results.jsonl> [--out RESULTS.md]
//   bun run mcp-eval down                    # stop and delete the eval stack

import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { agentEnv, isAnthropicModel, RefusedError, refuseMcpTarget } from "../safety";
import { summarize } from "../stream";
import { connector, context, type Ctx, localDate, provision, TIME_ZONE } from "./client";
import { down, status, up } from "./stack";
import { type McpTask, TASKS } from "./tasks";

const SOURCE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.HARNESS_AB_OUT ?? path.join(SOURCE, ".harness-ab");
/** The server name the agent sees, as in a person's own setup: tools are mcp__moduo__<tool>. */
export const SERVER = "moduo";
const AGENT_TIMEOUT_MS = 6 * 60_000;

export type ToolInfo = { name: string; readOnly: boolean; deprecated: boolean };

export type McpRow = {
  schema: 1;
  runId: string;
  batch: string;
  task: string;
  module: McpTask["module"];
  repeat: number;
  model: string;
  effort: string | null;
  startedAt: string;
  outcome: "pass" | "fail" | "error";
  reason: string | null;
  ms: number;
  calls: number;
  wrongTool: number;
  wrongTools: string[];
  toolErrors: number;
  toolSearch: number;
  tools: Record<string, number>;
  turns: number | null;
  costUsd: number | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  mcpServers: string[];
  /** The model ID the transcript reports (the alias resolved). */
  agentModel?: string | null;
  answer: string;
};

type StreamEvent = {
  type?: string;
  message?: {
    content?:
      | { type?: string; id?: string; name?: string; tool_use_id?: string; is_error?: boolean }[]
      | string;
  };
};

/**
 * The connector calls in a stream-json transcript, in order, with whether each came back an error.
 * Calls to other tools (ToolSearch) are counted apart.
 */
export function toolCalls(stream: string) {
  const acc: Tally = { byId: new Map(), calls: [], toolSearch: 0 };
  for (const ev of stream.split("\n").map(parseEvent))
    if (ev && Array.isArray(ev.message?.content))
      for (const block of ev.message.content) tally(acc, ev.type, block);
  return { calls: acc.calls, toolSearch: acc.toolSearch };
}

type Block = Extract<NonNullable<StreamEvent["message"]>["content"], unknown[]>[number];
type Tally = { byId: Map<string, Call>; calls: Call[]; toolSearch: number };

function tally(acc: Tally, type: string | undefined, b: Block) {
  if (type === "assistant" && b.type === "tool_use" && b.name) {
    const call = connectorCall(b.name);
    if (!call) {
      if (b.name === "ToolSearch") acc.toolSearch++;
      return;
    }
    acc.calls.push(call);
    if (b.id) acc.byId.set(b.id, call);
  } else if (type === "user" && b.type === "tool_result" && b.is_error) {
    const call = acc.byId.get(b.tool_use_id ?? "");
    if (call) call.error = true;
  }
}

type Call = { tool: string; error: boolean };

const parseEvent = (line: string): StreamEvent | null => {
  if (!line.trim().startsWith("{")) return null;
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return null;
  }
};

/** mcp__moduo__tasks_create → a call to tasks_create; any other tool → null. */
const connectorCall = (name: string): Call | null => {
  const prefix = `mcp__${SERVER}__`;
  return name.startsWith(prefix) ? { tool: name.slice(prefix.length), error: false } : null;
};

/** A wrong-tool call: a write the task doesn't call for, or a tool the connector marks deprecated. */
export function wrongTools(
  calls: { tool: string }[],
  task: Pick<McpTask, "writes">,
  info: Map<string, ToolInfo>,
) {
  return calls
    .map((c) => c.tool)
    .filter((tool) => {
      const t = info.get(tool);
      if (!t) return true;
      if (t.deprecated) return true;
      return !t.readOnly && !task.writes.includes(tool);
    });
}

/** What the agent is told besides the prompt: a plain assistant with Moduo connected. */
export function systemPrompt(today: string) {
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return [
    "You are Claude, a helpful assistant. The person you are talking to has connected their Moduo workspace",
    "(tasks, projects, notes, calendar, contacts, chat and links) through the moduo connector.",
    `Today is ${weekday}, ${today}; their time zone is ${TIME_ZONE}.`,
    "Do what they ask with the connector, then reply briefly. They are not available for follow-up questions.",
  ].join(" ");
}

export function claudeArgs(o: {
  prompt: string;
  model: string;
  effort?: string;
  mcpUrl: string;
  secret: string;
  today: string;
  maxTurns: number;
}) {
  const mcp = {
    mcpServers: {
      [SERVER]: { type: "http", url: o.mcpUrl, headers: { Authorization: `Bearer ${o.secret}` } },
    },
  };
  return [
    "-p",
    o.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--model",
    o.model,
    ...(o.effort ? ["--effort", o.effort] : []),
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify(mcp),
    // No built-in tools at all (no shell, no files, no web): the connector is the agent's only reach.
    "--tools",
    "",
    "--allowedTools",
    `mcp__${SERVER}`,
    "--setting-sources",
    "project",
    "--system-prompt",
    systemPrompt(o.today),
    "--max-turns",
    String(o.maxTurns),
  ];
}

function runClaude(
  args: string[],
  cwd: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd,
      env: agentEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), AGENT_TIMEOUT_MS);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function toolInfo(mcpUrl: string, dbUrl: string) {
  const account = provision(dbUrl, "tool-list");
  const tools = (await connector(mcpUrl, account.secret).tools()) as {
    name: string;
    description?: string;
    annotations?: { readOnlyHint?: boolean };
  }[];
  return new Map(
    tools.map((t) => [
      t.name,
      {
        name: t.name,
        readOnly: t.annotations?.readOnlyHint === true,
        deprecated: /^deprecated\b/i.test(t.description ?? ""),
      },
    ]),
  );
}

async function seeded(task: McpTask, label: string, target: { mcpUrl: string; dbUrl: string }) {
  const account = provision(target.dbUrl, label);
  const ctx: Ctx = context({ ...target, account, today: localDate() });
  ctx.seeded = (await task.seed?.(ctx)) ?? {};
  return { ctx, account };
}

async function runOne(
  task: McpTask,
  repeat: number,
  o: {
    batch: string;
    model: string;
    effort?: string;
    maxTurns: number;
    info: Map<string, ToolInfo>;
    target: { mcpUrl: string; dbUrl: string };
  },
): Promise<McpRow> {
  const runId = `${o.batch}-${task.id}-r${repeat}`;
  const dir = path.join(OUT, "mcp-runs", runId);
  mkdirSync(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const base = {
    schema: 1 as const,
    runId,
    batch: o.batch,
    task: task.id,
    module: task.module,
    repeat,
    model: o.model,
    effort: o.effort ?? null,
    startedAt,
  };
  const cwd = mkdtempSync(path.join(tmpdir(), "mcp-eval-"));
  try {
    const { ctx, account } = await seeded(task, runId, o.target);
    const args = claudeArgs({
      prompt: task.prompt,
      model: o.model,
      effort: o.effort,
      mcpUrl: o.target.mcpUrl,
      secret: account.secret,
      today: ctx.today,
      maxTurns: o.maxTurns,
    });
    const agent = await runClaude(args, cwd);
    writeFileSync(path.join(dir, "stream.jsonl"), agent.stdout);
    writeFileSync(path.join(dir, "agent.stderr.log"), agent.stderr);
    const summary = summarize(agent.stdout);
    const { calls, toolSearch } = toolCalls(agent.stdout);
    const wrong = wrongTools(calls, task, o.info);
    const metrics = {
      calls: calls.length,
      wrongTool: wrong.length,
      wrongTools: wrong,
      toolErrors: calls.filter((c) => c.error).length,
      toolSearch,
      tools: Object.fromEntries(
        Object.entries(summary.tools).map(([k, v]) => [k.replace(`mcp__${SERVER}__`, ""), v]),
      ),
      turns: summary.turns,
      costUsd: summary.costUsd,
      tokens: summary.usage,
      mcpServers: summary.mcpServers,
      agentModel: summary.model,
      answer: summary.result.slice(0, 1000),
    };
    const extra = summary.mcpServers.filter((s) => s !== SERVER);
    if (extra.length)
      return {
        ...base,
        ...metrics,
        outcome: "error",
        reason: `the agent saw other MCP servers: ${extra.join(", ")}`,
        ms: Date.now() - t0,
      };
    if (agent.stdout.trim() === "")
      return {
        ...base,
        ...metrics,
        outcome: "error",
        reason: `no stream (exit ${agent.status}): ${agent.stderr.slice(0, 300)}`,
        ms: Date.now() - t0,
      };
    const reason = await task.check(ctx, summary.result);
    return { ...base, ...metrics, outcome: reason ? "fail" : "pass", reason, ms: Date.now() - t0 };
  } catch (e) {
    return {
      ...base,
      outcome: "error",
      reason: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0,
      calls: 0,
      wrongTool: 0,
      wrongTools: [],
      toolErrors: 0,
      toolSearch: 0,
      tools: {},
      turns: null,
      costUsd: null,
      tokens: null,
      mcpServers: [],
      answer: "",
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** check-tasks: with no agent, the oracle fails on the seeded workspace and passes after the reference. */
async function checkTasks(only?: string[]) {
  const target = status();
  let bad = 0;
  for (const task of pick(only)) {
    const before = await seeded(task, `check-${task.id}`, target);
    const failsBefore = await task.check(before.ctx, "");
    const after = await seeded(task, `check-${task.id}-ref`, target);
    const answer = (await task.ref(after.ctx)) ?? "";
    const passesAfter = await task.check(after.ctx, answer);
    const sound = failsBefore !== null && passesAfter === null;
    if (!sound) bad++;
    console.log(JSON.stringify({ task: task.id, sound, before: failsBefore, after: passesAfter }));
  }
  return bad ? 1 : 0;
}

function pick(only?: string[]) {
  if (!only) return TASKS;
  const missing = only.filter((id) => !TASKS.some((t) => t.id === id));
  if (missing.length) throw new Error(`no task ${missing.join(", ")}`);
  return TASKS.filter((t) => only.includes(t.id));
}

async function run(f: Record<string, string>) {
  const model = f.model ?? "sonnet";
  if (!isAnthropicModel(model))
    throw new Error(`${model} is not an Anthropic model (Anthropic only)`);
  const target = status();
  const refused = refuseMcpTarget(target.mcpUrl);
  if (refused.length) throw new RefusedError(refused);
  const repeats = Number(f.repeats ?? "1");
  const parallel = Math.max(1, Number(f.parallel ?? "3"));
  const batch = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const info = await toolInfo(target.mcpUrl, target.dbUrl);
  const jobs = pick(f.tasks?.split(",")).flatMap((task) =>
    Array.from({ length: repeats }, (_, i) => ({ task, repeat: i + 1 })),
  );
  mkdirSync(path.join(OUT, "results"), { recursive: true });
  const results = path.join(OUT, "results", `${batch}-mcp.jsonl`);
  console.error(
    `mcp-eval: ${jobs.length} run(s), ${model}${f.effort ? ` @${f.effort}` : ""}, ${parallel} at a time → ${path.relative(SOURCE, results)}`,
  );
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const row = await runOne(job.task, job.repeat, {
        batch,
        model,
        effort: f.effort,
        maxTurns: Number(f["max-turns"] ?? "20"),
        info,
        target,
      });
      appendFileSync(results, `${JSON.stringify(row)}\n`);
      console.error(
        `  ${row.runId}: ${row.outcome}${row.reason ? ` (${row.reason.slice(0, 120)})` : ""} · ${row.calls} calls, ${row.wrongTool} wrong, $${row.costUsd?.toFixed(3) ?? "?"}`,
      );
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  console.log(results);
  return 0;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The results table: per task and overall success, wrong-tool rate, tool errors, tokens, cost. */
export function report(rows: McpRow[]) {
  const byTask = new Map<string, McpRow[]>();
  for (const r of rows) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  const tokens = (r: McpRow) =>
    r.tokens ? r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite : 0;
  const line = (label: string, rs: McpRow[]) => {
    const calls = rs.reduce((a, r) => a + r.calls, 0);
    const wrong = rs.reduce((a, r) => a + r.wrongTool, 0);
    const errors = rs.reduce((a, r) => a + r.toolErrors, 0);
    return `| ${label} | ${rs.filter((r) => r.outcome === "pass").length}/${rs.length} | ${rs.filter((r) => r.outcome === "error").length} | ${mean(rs.map((r) => r.calls)).toFixed(1)} | ${pct(wrong, calls)} | ${pct(errors, calls)} | ${Math.round(mean(rs.map(tokens)) / 1000)}k | ${Math.round(mean(rs.map((r) => r.tokens?.output ?? 0)))} | $${mean(rs.map((r) => r.costUsd ?? 0)).toFixed(3)} | ${(mean(rs.map((r) => r.ms)) / 1000).toFixed(0)}s |`;
  };
  const out = [
    "| task | pass | errors | calls/run | wrong-tool rate | tool-error rate | tokens/run | output tokens/run | cost/run | time/run |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...[...byTask].sort(([a], [b]) => a.localeCompare(b)).map(([t, rs]) => line(t, rs)),
    line("**all**", rows),
  ];
  const failures = rows
    .filter((r) => r.outcome !== "pass")
    .map(
      (r) =>
        `- \`${r.runId}\` ${r.outcome}: ${r.reason}${r.wrongTools.length ? ` (wrong tools: ${r.wrongTools.join(", ")})` : ""}`,
    );
  const wrongs = rows
    .filter((r) => r.wrongTools.length && r.outcome === "pass")
    .map((r) => `- \`${r.runId}\`: ${r.wrongTools.join(", ")}`);
  return [
    out.join("\n"),
    "",
    "Failures:",
    failures.length ? failures.join("\n") : "- none",
    "",
    "Wrong-tool calls in passing runs:",
    wrongs.length ? wrongs.join("\n") : "- none",
  ].join("\n");
}

function flags(argv: string[]) {
  const out: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i] ?? "";
    else rest.push(a);
  }
  return { out, rest };
}

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  const { out: f, rest } = flags(args);
  if (cmd === "up") return (console.log(JSON.stringify(up(), null, 2)), 0);
  if (cmd === "down") return (down(), 0);
  if (cmd === "check-tasks") return checkTasks(f.tasks?.split(","));
  if (cmd === "run") return run(f);
  if (cmd === "report") {
    const file = rest[0];
    if (!file) throw new Error("usage: report <results.jsonl> [--out file.md]");
    const rows = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as McpRow);
    const text = report(rows);
    if (f.out) writeFileSync(f.out, text + "\n");
    console.log(text);
    return 0;
  }
  console.error(
    "usage: bun run mcp-eval up | check-tasks | run --repeats 5 [--model sonnet] [--effort low] [--tasks …] [--parallel 3] | report <file> | down",
  );
  return 64;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(e instanceof RefusedError ? 3 : 1);
    },
  );
}
