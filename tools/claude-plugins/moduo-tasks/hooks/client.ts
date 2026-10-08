// Pure parts of the Moduo connector client (moduo-mcp, JSON-RPC `tools/call`).
// The network call itself lives in register.tsx: only its top-level functions may use `$`.
import type { Problem } from "../types";

export const DEFAULT_ENDPOINT = "https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/moduo-mcp";

export class ConnectorError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(PROBLEM_TEXT[problem]);
    this.problem = problem;
  }
}

/** What the person reads for each problem. */
export const PROBLEM_TEXT: Record<Problem, string> = {
  nokey:
    "Add your Moduo API key to use this: in Moduo, Workspace settings → API keys, create one with Tasks set to edit, then paste it into this plugin’s settings (/plugin → moduo-tasks).",
  rejected: "Moduo rejected the key. Create a new one in Workspace settings → API keys.",
  noaccess: "This key has no access to Tasks. Create one with Tasks set to view or edit.",
  offline: "Offline · retrying",
  error: "Moduo answered with an error. It will retry on the next refresh.",
  endpoint: "The Moduo connector URL in this plugin’s settings must start with https://.",
};

/** Maps an HTTP status (null = no answer at all) and an error message to a problem. */
export function classify(status: number | null, message: string): Problem {
  if (status === null || status === 0) return "offline";
  if (status === 401 || status === 403) return "rejected";
  if (/unknown tool|not available|no (view |edit )?access|scope/i.test(message)) return "noaccess";
  if (status >= 500) return "offline";
  return "error";
}

export function requestBody(id: number, tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });
}

export function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
}

type Rpc = {
  result?: { content?: { text?: string }[]; isError?: boolean };
  error?: { message?: string };
};

/** Reads a connector answer: the tool's JSON payload, or a ConnectorError naming the problem. */
export function parseAnswer<T>(status: number, text: string): T {
  let body: Rpc | null = null;
  try {
    body = JSON.parse(text) as Rpc;
  } catch {
    body = null;
  }
  const rpcError = body?.error?.message ?? "";
  const payload = body?.result?.content?.[0]?.text ?? "";
  if (status !== 200 || rpcError || body?.result?.isError || !body) {
    throw new ConnectorError(classify(status, rpcError || payload));
  }
  try {
    return JSON.parse(payload) as T;
  } catch {
    throw new ConnectorError("error");
  }
}
