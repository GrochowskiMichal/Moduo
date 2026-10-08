import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  entityTypeKeyModule,
  keyCanSeeEntityType,
  keyScopeAllows,
  keyVisibleEntityTypes,
  MCP_ENTITY_TYPE_MODULES,
  MCP_KEY_MODULE_LABELS,
  MCP_TOOL_NEEDS,
  mcpKeyScopeRank,
  mcpToolNeeds,
} from "./mcp-key-scopes.ts";
import { MCP_KEY_MODULES } from "./vocabularies.ts";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

describe("keyScopeAllows", () => {
  it("ranks none < view < edit and reads anything else as none", () => {
    expect(mcpKeyScopeRank("none")).toBeLessThan(mcpKeyScopeRank("view"));
    expect(mcpKeyScopeRank("view")).toBeLessThan(mcpKeyScopeRank("edit"));
    expect(keyScopeAllows({ notes: "edit" }, "notes", "view")).toBe(true);
    expect(keyScopeAllows({ notes: "view" }, "notes", "edit")).toBe(false);
    expect(keyScopeAllows({ notes: "admin" }, "notes", "view")).toBe(false);
    expect(keyScopeAllows({}, "notes", "view")).toBe(false);
    expect(keyScopeAllows(null, "notes", "view")).toBe(false);
  });
});

describe("MCP_TOOL_NEEDS", () => {
  it("names only key modules, and never a tool's own module", () => {
    for (const n of MCP_TOOL_NEEDS) {
      expect(MCP_KEY_MODULES).toContain(n.module);
      expect(MCP_KEY_MODULES).toContain(n.needs);
      expect(n.needs).not.toBe(n.module);
      expect(n.tool.startsWith(`${n.module}_`)).toBe(true);
    }
  });

  it("answers per tool, empty for tools with no cross-module need", () => {
    expect(mcpToolNeeds("calendar_schedule_task")).toEqual(["tasks"]);
    expect(mcpToolNeeds("notes_link")).toEqual(["links"]);
    expect(mcpToolNeeds("tasks_commit")).toEqual([]);
  });
});

describe("entity types → key modules", () => {
  it("maps only to key modules, with a plain label for each module", () => {
    for (const module of Object.values(MCP_ENTITY_TYPE_MODULES)) {
      expect(MCP_KEY_MODULES).toContain(module);
    }
    for (const module of MCP_KEY_MODULES) expect(MCP_KEY_MODULE_LABELS[module].length).toBeGreaterThan(0);
  });

  it("agrees with Postgres' perm_entity_module for every type both know", () => {
    // The person-side map (PERM-1). Keys add email / chat / account types on top.
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261006200000_perm1_roles_overrides.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.perm_entity_module"));
    const body = fn.slice(0, fn.indexOf("$$;", fn.indexOf("AS $$") + 5));
    const pairs = [...body.matchAll(/WHEN '([a-z_]+)' THEN '([a-z_]+)'/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBeGreaterThan(4);
    for (const [type, module] of pairs) expect(entityTypeKeyModule(type), type).toBe(module);
  });

  it("leaves unknown types to no module, so no key sees them", () => {
    expect(entityTypeKeyModule("payment")).toBeNull();
    expect(entityTypeKeyModule("toString")).toBeNull();
    expect(keyCanSeeEntityType({ tasks: "edit" }, "payment")).toBe(false);
    expect(keyCanSeeEntityType({ tasks: "view" }, "task")).toBe(true);
    expect(keyCanSeeEntityType({ tasks: "view" }, "note")).toBe(false);
  });

  it("lists exactly the types a key can see, for filtering a query", () => {
    expect(keyVisibleEntityTypes({ tasks: "view" })).toEqual(["task", "bucket", "task_project"]);
    expect(keyVisibleEntityTypes({ contacts: "edit", notes: "none" })).toEqual([
      "contact",
      "company",
      "contact_group",
    ]);
    expect(keyVisibleEntityTypes({ links: "edit" })).toEqual([]);
    expect(keyVisibleEntityTypes(null)).toEqual([]);
    const all = keyVisibleEntityTypes(Object.fromEntries(MCP_KEY_MODULES.map((m) => [m, "view"])));
    expect(all).toEqual(Object.keys(MCP_ENTITY_TYPE_MODULES));
  });
});
