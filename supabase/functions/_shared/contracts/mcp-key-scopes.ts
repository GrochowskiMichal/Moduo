/**
 * MCP key-scope policy, shared by the connector (supabase/functions/moduo-mcp)
 * and Settings → API keys. No I/O, so both runtimes import it.
 *
 * A key holds none / view / edit per module (MCP_KEY_MODULES), already capped
 * by what its creator can do (module_api_key_effective_scopes). The connector
 * lists and runs a tool only when the key holds the tool's own level on its
 * module and Edit on every module in MCP_TOOL_NEEDS for that tool: the other
 * modules whose guards the tool's RPCs check. src/features/settings/
 * api-keys.test.ts re-derives that list from the connector's call sites and
 * the latest SQL, so a new cross-module guard can't land without an entry.
 */

import {
  type McpKeyModule,
  type McpKeyScope,
  normalizeMcpKeyScope,
} from "./vocabularies.ts";

export type McpToolAccess = "view" | "edit";

const RANK: Record<McpKeyScope, number> = { none: 0, view: 1, edit: 2 };

/** none < view < edit. */
export function mcpKeyScopeRank(level: McpKeyScope): number {
  return RANK[level];
}

/** Does this scope map give `module` at least `level`? Absent, unknown and admin read as none. */
export function keyScopeAllows(
  scopes: Readonly<Record<string, unknown>> | null | undefined,
  module: string,
  level: McpToolAccess,
): boolean {
  return RANK[normalizeMcpKeyScope(scopes?.[module])] >= RANK[level];
}

/** Plain module names, as Settings and the connector's messages say them. */
export const MCP_KEY_MODULE_LABELS: Readonly<Record<McpKeyModule, string>> = {
  tasks: "Tasks",
  notes: "Notes",
  calendar: "Calendar",
  email: "Email",
  contacts: "Contacts",
  chat: "Chat",
  links: "Links",
};

/**
 * Tools that also need Edit on another module, because an RPC they call is
 * guarded by that module's key scope:
 * - Calendar's task-block tools move and complete the task itself (tasks_op_*).
 * - notes_link creates a spine link (links_op_create, the Links guard).
 */
export const MCP_TOOL_NEEDS: ReadonlyArray<{
  tool: string;
  module: McpKeyModule;
  access: McpToolAccess;
  needs: McpKeyModule;
}> = [
  { tool: "calendar_schedule_task", module: "calendar", access: "edit", needs: "tasks" },
  { tool: "calendar_move_block", module: "calendar", access: "edit", needs: "tasks" },
  { tool: "calendar_complete_block", module: "calendar", access: "edit", needs: "tasks" },
  { tool: "calendar_roll_forward", module: "calendar", access: "edit", needs: "tasks" },
  { tool: "notes_link", module: "notes", access: "edit", needs: "links" },
];

/** The other modules a tool needs at Edit (empty for most tools). */
export function mcpToolNeeds(tool: string): McpKeyModule[] {
  return MCP_TOOL_NEEDS.filter((n) => n.tool === tool).map((n) => n.needs);
}

/**
 * Which module's key scope governs an entity type on the spine (search
 * results, link endpoints, comment targets). Entity types stay open strings;
 * a type missing here belongs to no module, so no key can see or touch it.
 */
export const MCP_ENTITY_TYPE_MODULES: Readonly<Record<string, McpKeyModule>> = {
  task: "tasks",
  bucket: "tasks",
  task_project: "tasks",
  note: "notes",
  event: "calendar",
  calendar: "calendar",
  calendar_account: "calendar",
  email_thread: "email",
  email_account: "email",
  contact: "contacts",
  company: "contacts",
  contact_group: "contacts",
  chat_channel: "chat",
  chat_message: "chat",
};

export function entityTypeKeyModule(type: string): McpKeyModule | null {
  return Object.hasOwn(MCP_ENTITY_TYPE_MODULES, type) ? MCP_ENTITY_TYPE_MODULES[type] : null;
}

/** Can a key with these scopes see entities of this type at all? */
export function keyCanSeeEntityType(
  scopes: Readonly<Record<string, unknown>> | null | undefined,
  type: string,
): boolean {
  const module = entityTypeKeyModule(type);
  return module !== null && keyScopeAllows(scopes, module, "view");
}
