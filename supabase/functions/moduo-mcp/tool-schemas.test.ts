/**
 * The two halves of each connector tool's arguments agree (MOD-92). A tool's
 * `inputSchema` in modules/*.ts (field names and descriptions, what its prose
 * promises) and its Zod schema (`TOOL_ARG_SCHEMAS` in
 * contracts/mcp-tool-args.ts: what `tools/list` shows and what a call keeps)
 * are written apart. A field only the `inputSchema` has is promised, then
 * dropped by the parser without a word, as `projects_update`'s description was.
 */

import { describe, expect, it, rs } from "@rstest/core";

import { listingJsonSchema, TOOL_ARG_SCHEMAS } from "../_shared/contracts/mcp-tool-args.ts";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { connectorModules, toolAnnotations, type KeyContext } from "./registry.ts";
import { outputJsonSchema } from "./tool-outputs.ts";
import { listThroughSdk } from "./through-sdk.ts";

type Schema = { properties?: Record<string, unknown>; required?: string[] };

const tools = connectorModules.flatMap((m) => m.tools);

describe("connector tool arguments: listing and parser", () => {
  it("cover every tool", () => {
    expect(tools.length).toBeGreaterThan(40);
    for (const tool of tools) expect(TOOL_ARG_SCHEMAS[tool.name], tool.name).toBeDefined();
  });

  it("name the same fields, so nothing listed is dropped and nothing kept is hidden", () => {
    for (const tool of tools) {
      const listed = Object.keys((tool.inputSchema as Schema).properties ?? {}).sort();
      const parsed = Object.keys((listingJsonSchema(tool.name) as Schema).properties ?? {}).sort();
      expect(parsed, tool.name).toEqual(listed);
    }
  });

  it("are what a client lists through the SDK server, word for word", async () => {
    const scopes = Object.fromEntries(connectorModules.map((m) => [m.module, "edit"]));
    const key: KeyContext = { id: "key-1", workspaceId: "ws", name: "Agent", createdBy: "u", scopes };
    const listed = await listThroughSdk(key);
    expect(listed.map((t) => t.name)).toEqual(tools.map((t) => t.name));
    for (const tool of tools) {
      const entry = listed.find((t) => t.name === tool.name);
      const output = outputJsonSchema(tool.name);
      expect(entry, tool.name).toEqual({
        name: tool.name,
        description: tool.description,
        inputSchema: listingJsonSchema(tool.name, tool.inputSchema),
        annotations: toolAnnotations(tool),
        // A list's array schema is listed wrapped as { result }, the 2025-era wire shape.
        ...(output
          ? { outputSchema: output.type === "object" ? output : { type: "object", properties: { result: output }, required: ["result"] } }
          : {}),
      });
    }
  });

  it("agree on which fields are required", () => {
    for (const tool of tools) {
      const listed = [...((tool.inputSchema as Schema).required ?? [])].sort();
      const parsed = [...((listingJsonSchema(tool.name) as Schema).required ?? [])].sort();
      expect(parsed, tool.name).toEqual(listed);
    }
  });
});
