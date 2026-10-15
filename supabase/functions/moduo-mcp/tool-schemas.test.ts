/**
 * The two halves of each connector tool's arguments agree (MOD-92). A tool's
 * listing (`inputSchema` in modules/*.ts: names and descriptions) and its
 * parser (`TOOL_ARG_SCHEMAS` in contracts/mcp-tool-args.ts: what a call keeps)
 * are written apart. A field only the listing has is advertised and then
 * dropped by the parser without a word, as `projects_update`'s description was.
 */

import { describe, expect, it, rs } from "@rstest/core";

import { listingJsonSchema, TOOL_ARG_SCHEMAS } from "../_shared/contracts/mcp-tool-args.ts";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { connectorModules } from "./registry.ts";

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

  it("agree on which fields are required", () => {
    for (const tool of tools) {
      const listed = [...((tool.inputSchema as Schema).required ?? [])].sort();
      const parsed = [...((listingJsonSchema(tool.name) as Schema).required ?? [])].sort();
      expect(parsed, tool.name).toEqual(listed);
    }
  });
});
