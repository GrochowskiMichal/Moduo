/**
 * Test helper: call the connector's tools the way a client does, through the
 * SDK server (server.ts `answerMessage`), with the test's own database
 * stand-in as the key's client. The connector tests use it so they cover the
 * protocol layer, the per-key tool list and `parseToolArgs`, not just the
 * handlers (MCPO-2).
 */

import type { KeyContext, ToolContext } from "./registry.ts";
import { answerMessage, type ConnectorDeps } from "./server.ts";
import { TOOL_OUTPUT_SCHEMAS } from "./tool-outputs.ts";

type ToolListing = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

function depsFor(ctx: ToolContext): ConnectorDeps {
  return {
    admin: ctx.db,
    keyClient: (keyId) => {
      if (keyId !== ctx.key.id) throw new Error(`tool ran as ${keyId}, not ${ctx.key.id}`);
      return ctx.db;
    },
  };
}

async function rpc(ctx: ToolContext, method: string, params: unknown): Promise<any> {
  const res = await answerMessage({ jsonrpc: "2.0", id: 1, method, params } as never, ctx.key, depsFor(ctx));
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/**
 * tools/call through the SDK: resolves to the tool's answer (parsed back from
 * its JSON text) and rejects with its error text, as the handler would.
 * A main read's answer must also come as `structuredContent`, the same value
 * as the text, and match its output schema (MCPO-6), so every connector test
 * that reads through one checks its real answers against the schema.
 */
export async function callThroughSdk(name: string, args: unknown, ctx: ToolContext): Promise<any> {
  const result = await rpc(ctx, "tools/call", { name, arguments: args });
  const text: string = result.content?.[0]?.text ?? "";
  if (result.isError) throw new Error(text);
  const answer = text === "" ? undefined : JSON.parse(text);
  checkStructuredAnswer(name, answer, result.structuredContent);
  return answer;
}

/**
 * A main read's `structuredContent` against its text answer and its output
 * schema; nothing for any other tool. A list comes wrapped as `{ result }`
 * (the 2025-era wire shape the SDK projects to).
 */
export function checkStructuredAnswer(name: string, answer: unknown, structured: unknown): void {
  const schema = TOOL_OUTPUT_SCHEMAS[name];
  if (!schema) {
    if (structured !== undefined) throw new Error(`${name} has no output schema but answered structuredContent`);
    return;
  }
  const value = Array.isArray(answer) ? (structured as { result?: unknown } | undefined)?.result : structured;
  if (JSON.stringify(value) !== JSON.stringify(answer)) {
    throw new Error(`${name}'s structuredContent differs from its text answer`);
  }
  const checked = schema.safeParse(value);
  if (!checked.success) {
    throw new Error(`${name}'s answer doesn't match its output schema: ${JSON.stringify(checked.error.issues)}`);
  }
}

/** tools/list through the SDK, for this key. */
export async function listThroughSdk(key: KeyContext): Promise<ToolListing[]> {
  const unused = new Proxy({}, {
    get() {
      throw new Error("tools/list must not touch the database");
    },
  }) as ToolContext["db"];
  return (await rpc({ key, db: unused }, "tools/list", {})).tools;
}
