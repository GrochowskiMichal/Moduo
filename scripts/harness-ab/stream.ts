// Reads `claude -p --output-format stream-json --verbose` output into the row's agent summary.

import type { AgentSummary } from "./model";

type Block = { type?: string; name?: string; input?: { command?: string } };
type Event = {
  type?: string;
  subtype?: string;
  model?: string;
  mcp_servers?: { name: string; status?: string }[];
  plugins?: { name: string; source?: string }[];
  message?: { content?: Block[] | string };
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

/** A Bash command that runs tests (counts the agent's tries). */
const TEST_COMMAND =
  /\b(rstest|vitest|jest|cargo\s+test|db:test|playwright)\b|\bbun\s+(run\s+)?(--cwd\s+\S+\s+)?test\b/;
/** The defect report the impossible-spec task asks for: a line that starts with DEFECT REPORT. */
const DEFECT = /^\s*[#*>\s]*DEFECT REPORT\b/im;

const parse = (line: string): Event | null => {
  if (!line.trim().startsWith("{")) return null;
  try {
    return JSON.parse(line) as Event;
  } catch {
    return null;
  }
};

function onInit(out: AgentSummary, ev: Event) {
  out.model = ev.model ?? null;
  out.mcpServers = (ev.mcp_servers ?? []).map((s) => s.name);
  out.plugins = (ev.plugins ?? [])
    .map((p) => p.source ?? p.name)
    .filter((id) => !id.endsWith("@builtin"))
    .sort();
}

function onAssistant(out: AgentSummary, content: Block[]) {
  for (const block of content) {
    if (block.type !== "tool_use" || !block.name) continue;
    out.tools[block.name] = (out.tools[block.name] ?? 0) + 1;
    if (block.name === "Bash" && TEST_COMMAND.test(block.input?.command ?? "")) out.testRuns++;
  }
}

function onResult(out: AgentSummary, ev: Event) {
  const u = ev.usage;
  Object.assign(out, {
    subtype: ev.subtype ?? null,
    isError: ev.is_error ?? ev.subtype !== "success",
    turns: ev.num_turns ?? null,
    costUsd: ev.total_cost_usd ?? null,
    durationMs: ev.duration_ms ?? null,
    result: ev.result ?? "",
    usage: u
      ? {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
        }
      : null,
  });
}

export function summarize(stream: string): AgentSummary {
  const out: AgentSummary = {
    model: null,
    mcpServers: [],
    plugins: [],
    subtype: null,
    isError: false,
    turns: null,
    costUsd: null,
    durationMs: null,
    usage: null,
    tools: {},
    testRuns: 0,
    defectReport: false,
    result: "",
  };
  let sawResult = false;
  for (const ev of stream.split("\n").map(parse)) {
    if (ev?.type === "system" && ev.subtype === "init") onInit(out, ev);
    else if (ev?.type === "assistant" && Array.isArray(ev.message?.content))
      onAssistant(out, ev.message.content);
    else if (ev?.type === "result") {
      sawResult = true;
      onResult(out, ev);
    }
  }
  if (!sawResult) out.isError = true;
  out.defectReport = DEFECT.test(out.result);
  return out;
}
