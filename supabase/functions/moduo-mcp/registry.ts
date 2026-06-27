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

import { tasksConnectorModule } from "./modules/tasks.ts";
import { linksConnectorModule } from "./modules/links.ts";

/** A verified, live API key — the connector's caller identity. */
export type KeyContext = {
  id: string;
  workspaceId: string;
  name: string;
  /** module → 'none' | 'view' | 'edit' (admin is never key-grantable). */
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
  /** Minimum key scope that exposes this tool. */
  access: "view" | "edit";
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export type ConnectorModule = {
  /** Module id — matches module_activity.module and the key's scopes key. */
  module: string;
  tools: ToolDef[];
};

export const connectorModules: ConnectorModule[] = [tasksConnectorModule, linksConnectorModule];

/** Normalize a key's scope for a module (absent/unknown → none). */
export function moduleScope(key: KeyContext, module: string): "none" | "view" | "edit" {
  const raw = (key.scopes?.[module] ?? "none").toLowerCase();
  return raw === "edit" || raw === "view" ? raw : "none";
}

/** The tools this key may see/call, across all registered modules. */
export function toolsForKey(key: KeyContext): ToolDef[] {
  const out: ToolDef[] = [];
  for (const mod of connectorModules) {
    const scope = moduleScope(key, mod.module);
    if (scope === "none") continue;
    for (const tool of mod.tools) {
      if (tool.access === "view" || scope === "edit") out.push(tool);
    }
  }
  return out;
}
