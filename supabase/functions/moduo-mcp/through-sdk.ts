/**
 * Test helper: call the connector's tools the way a client does, through the
 * SDK server (server.ts `answerMessage`), with the test's own database
 * stand-in as the key's client. The connector tests use it so they cover the
 * protocol layer, the per-key tool list and `parseToolArgs`, not just the
 * handlers (MCPO-2).
 */

import type { KeyContext, ToolContext } from "./registry.ts";
import { answerMessage, type ConnectorDeps } from "./server.ts";

type ToolListing = { name: string; description: string; inputSchema: Record<string, unknown> };

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
 */
export async function callThroughSdk(name: string, args: unknown, ctx: ToolContext): Promise<any> {
  const result = await rpc(ctx, "tools/call", { name, arguments: args });
  const text: string = result.content?.[0]?.text ?? "";
  if (result.isError) throw new Error(text);
  return text === "" ? undefined : JSON.parse(text);
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
