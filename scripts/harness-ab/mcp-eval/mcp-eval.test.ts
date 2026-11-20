import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { refuseMcpTarget } from "../safety";
import { addDays, connector, nextWeekday } from "./client";
import {
  claudeArgs,
  type McpRow,
  report,
  SERVER,
  toolCalls,
  type ToolInfo,
  wrongTools,
} from "./eval";
import { API_PORT, DB_PORT, EVAL_PROJECT_ID, evalConfig, MCP_URL } from "./stack";
import { TASKS } from "./tasks";

// The MCP agent-experience eval (specs/harness-v3.md, HV-29, AC38): it runs on its own stack, never
// the shared one or production, and scores runs from the agent's transcript.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const config = readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");

describe("the eval stack", () => {
  it("moves the project id and every shared-stack port out of the way", () => {
    const out = evalConfig(config);
    expect(out).toContain(`project_id = "${EVAL_PROJECT_ID}"`);
    expect(out).not.toMatch(/^\s*\w*port\s*=\s*543\d\d\b/m);
    expect(out).toMatch(new RegExp(`^port = ${API_PORT}$`, "m"));
    expect(out).toMatch(new RegExp(`^port = ${DB_PORT}$`, "m"));
    expect(EVAL_PROJECT_ID).not.toBe("moduo");
  });

  it("refuses a config it can't rewrite", () => {
    expect(() => evalConfig("[api]\nport = 54321\n")).toThrow(/project_id/);
  });
});

describe("the MCP target", () => {
  it("allows only the eval stack's local connector", () => {
    expect(refuseMcpTarget(MCP_URL)).toEqual([]);
  });

  it.each([
    "http://127.0.0.1:54321/functions/v1/moduo-mcp",
    "http://localhost:54321/functions/v1/moduo-mcp",
    "https://mcp.moduo.app",
    "https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/moduo-mcp",
    "http://127.0.0.1:55321/functions/v1/other",
  ])("refuses %s", (url) => {
    expect(refuseMcpTarget(url).length).toBeGreaterThan(0);
    expect(() => connector(url, "moduo_sk_x")).toThrow();
  });
});

describe("the agent", () => {
  const args = claudeArgs({
    prompt: "Add a task",
    model: "sonnet",
    mcpUrl: MCP_URL,
    secret: "moduo_sk_test",
    today: "2026-10-27",
    maxTurns: 20,
  });
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("gets the eval connector as its only MCP server and no built-in tools", () => {
    expect(args).toContain("--strict-mcp-config");
    const mcp = JSON.parse(after("--mcp-config") ?? "{}");
    expect(Object.keys(mcp.mcpServers)).toEqual([SERVER]);
    expect(mcp.mcpServers[SERVER].url).toBe(MCP_URL);
    expect(after("--tools")).toBe("");
    expect(after("--allowedTools")).toBe(`mcp__${SERVER}`);
  });
});

describe("scoring", () => {
  const line = (o: unknown) => JSON.stringify(o);
  const stream = [
    line({ type: "system", subtype: "init", mcp_servers: [{ name: SERVER }] }),
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "a", name: `mcp__${SERVER}__tasks_today` }] },
    }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a" }] } }),
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "b", name: `mcp__${SERVER}__tasks_create` }] },
    }),
    line({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "b", is_error: true }] },
    }),
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "c", name: `mcp__${SERVER}__notes_trash` }] },
    }),
    line({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "d", name: "ToolSearch" }] },
    }),
  ].join("\n");
  const info = new Map<string, ToolInfo>([
    ["tasks_today", { name: "tasks_today", readOnly: true, deprecated: true }],
    ["tasks_create", { name: "tasks_create", readOnly: false, deprecated: false }],
    ["notes_trash", { name: "notes_trash", readOnly: false, deprecated: false }],
  ]);

  it("counts connector calls and their errors from the transcript", () => {
    const { calls, toolSearch } = toolCalls(stream);
    expect(calls.map((c) => c.tool)).toEqual(["tasks_today", "tasks_create", "notes_trash"]);
    expect(calls.map((c) => c.error)).toEqual([false, true, false]);
    expect(toolSearch).toBe(1);
  });

  it("calls a deprecated tool or a write the task doesn't need a wrong tool", () => {
    const { calls } = toolCalls(stream);
    expect(wrongTools(calls, { writes: ["tasks_create"] }, info)).toEqual([
      "tasks_today",
      "notes_trash",
    ]);
  });

  it("reports pass rate and wrong-tool rate per task and overall", () => {
    const row = (task: string, outcome: McpRow["outcome"], calls: number, wrong: number) =>
      ({
        task,
        outcome,
        calls,
        wrongTool: wrong,
        wrongTools: [],
        toolErrors: 0,
        ms: 1000,
        runId: task,
        reason: null,
        tokens: null,
        costUsd: 0.1,
      }) as unknown as McpRow;
    const text = report([row("a", "pass", 2, 0), row("a", "fail", 2, 1), row("b", "pass", 4, 1)]);
    expect(text).toContain("| a | 1/2 |");
    expect(text).toContain("| **all** | 2/3 | 0 | 2.7 | 25% |");
  });
});

describe("the task set", () => {
  it("has 15 tasks with unique ids, prompts and an oracle each", () => {
    expect(TASKS).toHaveLength(15);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(15);
    for (const t of TASKS) {
      expect(t.prompt.length).toBeGreaterThan(10);
      expect(typeof t.check).toBe("function");
      // A prompt is what a person says: it never names the connector's tools.
      expect(t.prompt).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    }
  });

  it("does its date arithmetic in local days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(nextWeekday("2026-10-27", 1)).toBe("2026-11-02");
    expect(nextWeekday("2026-11-02", 1)).toBe("2026-11-09");
  });
});
