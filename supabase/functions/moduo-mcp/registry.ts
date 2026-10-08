/**
 * The Moduo MCP connector's module registry (docs/moduo-mcp-connector.md).
 *
 * Connector-side mirror of the app's module registry
 * (src/lib/module-registry.ts — Deno can't import the app's extensionless
 * modules, so each module contributes a ConnectorModule here; tool
 * descriptions reuse the manifest summaries verbatim). Onboarding module N+1
 * = one entry in `connectorModules` + a modules/<name>.ts file.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  keyScopeAllows,
  MCP_KEY_MODULE_LABELS,
  mcpToolNeeds,
} from "../_shared/contracts/mcp-key-scopes.ts";
import { isMcpKeyModule, normalizeMcpKeyScope } from "../_shared/contracts/vocabularies.ts";
import { tasksConnectorModule } from "./modules/tasks.ts";
import { linksConnectorModule } from "./modules/links.ts";
import { contactsConnectorModule } from "./modules/contacts.ts";
import { calendarConnectorModule } from "./modules/calendar.ts";
import { notesConnectorModule } from "./modules/notes.ts";
import { emailConnectorModule } from "./modules/email.ts";
import { chatConnectorModule } from "./modules/chat.ts";

/** A verified, live API key — the connector's caller identity. */
export type KeyContext = {
  id: string;
  workspaceId: string;
  name: string;
  /** The user the key acts as (PERM-0) — owner-only data is filtered to them. */
  createdBy: string;
  /** module → 'none' | 'view' | 'edit', already capped by the creator's permission. */
  scopes: Record<string, string>;
};

export type ToolContext = {
  key: KeyContext;
  /** Service-role client carrying the x-moduo-key-id actor header. */
  db: SupabaseClient;
};

export type ToolDef = {
  /** MCP tool name — [a-zA-Z0-9_-], so `tasks_commit`, not `tasks.commit`. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Minimum key scope on this tool's module that exposes it. Tools that also
   * need another module are listed in MCP_TOOL_NEEDS (contracts).
   */
  access: "view" | "edit";
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export type ConnectorModule = {
  /** Module id — matches module_activity.module and the key's scopes key. */
  module: string;
  tools: ToolDef[];
};

export const connectorModules: ConnectorModule[] = [
  tasksConnectorModule,
  linksConnectorModule,
  contactsConnectorModule,
  calendarConnectorModule,
  notesConnectorModule,
  emailConnectorModule,
  chatConnectorModule,
];

/** Normalize a key's scope for a module (absent/unknown → none). */
export function moduleScope(key: KeyContext, module: string): "none" | "view" | "edit" {
  return normalizeMcpKeyScope(key.scopes?.[module]);
}

/**
 * May this key list and call this tool? It needs the tool's own level on the
 * tool's module, plus Edit on every module the tool's RPCs also guard
 * (MCP_TOOL_NEEDS: e.g. Calendar's task-block tools move the task itself).
 */
export function toolAllowed(key: KeyContext, module: string, tool: ToolDef): boolean {
  if (!keyScopeAllows(key.scopes, module, tool.access)) return false;
  return mcpToolNeeds(tool.name).every((needed) => keyScopeAllows(key.scopes, needed, "edit"));
}

/** What a tool needs, in words: "Calendar: Edit and Tasks: Edit". */
export function toolRequirement(module: string, tool: ToolDef): string {
  const label = (m: string) => (isMcpKeyModule(m) ? MCP_KEY_MODULE_LABELS[m] : m);
  const parts = [`${label(module)}: ${tool.access === "edit" ? "Edit" : "View"}`];
  for (const needed of mcpToolNeeds(tool.name)) parts.push(`${label(needed)}: Edit`);
  return parts.join(" and ");
}

/** The registered tool with this name, and its module. */
export function findTool(name: string): { module: string; tool: ToolDef } | null {
  for (const mod of connectorModules) {
    const tool = mod.tools.find((t) => t.name === name);
    if (tool) return { module: mod.module, tool };
  }
  return null;
}

/** The tools this key may see/call, across all registered modules. */
export function toolsForKey(key: KeyContext): ToolDef[] {
  const out: ToolDef[] = [];
  for (const mod of connectorModules) {
    for (const tool of mod.tools) {
      if (toolAllowed(key, mod.module, tool)) out.push(tool);
    }
  }
  return out;
}
