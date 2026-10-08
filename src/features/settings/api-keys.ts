// Pure helpers for Settings → API keys (DF-19d; per-module scopes on
// t/maciej/api-key-module-scopes). No UI imports, so the scope rules, and the
// exact payload sent to the server, are unit-tested on their own.
//
// A key holds None / View / Edit per module, acts as the person who created it
// (PERM-0), and never gets more than that person can do. The server enforces
// all of it (workspace_api_keys_create / _set_scopes, and the connector caps
// every call); this file mirrors the rules so the screen can explain them.

import { MCP_KEY_MODULE_LABELS, MCP_TOOL_NEEDS, mcpKeyScopeRank } from "@contracts/mcp-key-scopes";
import {
  MCP_KEY_MODULES,
  MCP_KEY_SCOPES,
  type McpKeyModule,
  type McpKeyScope,
  type McpKeyScopes,
  normalizeMcpKeyScopes,
  PERMISSION_MODULES,
  type PermissionKey,
  type WorkspaceRole,
} from "@contracts/vocabularies";

export { MCP_KEY_MODULES, MCP_KEY_SCOPES, type McpKeyModule, type McpKeyScope, type McpKeyScopes };

/** Control labels. Kept plain: the landing's key card shows these exact words. */
export const KEY_SCOPE_LABELS: Record<McpKeyScope, string> = {
  none: "None",
  view: "View",
  edit: "Edit",
};

const HINTS: Record<McpKeyModule, string> = {
  tasks: "Tasks, tags and the day's plan",
  notes: "Notes and what's in them",
  calendar: "Events and scheduled tasks",
  email: "Threads and follow-ups, never full message bodies",
  contacts: "People and companies",
  chat: "Public channels only, never DMs or private channels",
  links: "Links, comments and search across the modules this key can see",
};

/** Every module a key can reach, in key-card order, with what its tools touch. */
export const KEY_SCOPE_MODULES: ReadonlyArray<{
  module: McpKeyModule;
  label: string;
  hint: string;
}> = MCP_KEY_MODULES.map((module) => ({
  module,
  label: MCP_KEY_MODULE_LABELS[module],
  hint: HINTS[module],
}));

/** Where a new key starts: read-only Tasks and nothing else (the server's own default). */
export const DEFAULT_KEY_SCOPES: Readonly<McpKeyScopes> = {
  tasks: "view",
  notes: "none",
  calendar: "none",
  email: "none",
  contacts: "none",
  chat: "none",
  links: "none",
};

/** What a row says when its module's tools need another module too (MCP_TOOL_NEEDS). */
const NEED_NOTES: Readonly<Record<string, string>> = {
  "calendar>tasks": "Moving scheduled tasks also needs Tasks: Edit.",
  "notes>links": "Linking notes also needs Links: Edit.",
};

/**
 * The row notes the connector's cross-module needs imply: `module` at `when`
 * or above lists tools that also need Edit on `needs`. Derived from
 * MCP_TOOL_NEEDS, so a new need without a note fails the tests.
 */
export const KEY_SCOPE_NEEDS: ReadonlyArray<{
  module: McpKeyModule;
  when: "view" | "edit";
  needs: McpKeyModule;
  note: string;
}> = [
  ...new Map(
    MCP_TOOL_NEEDS.map(({ module, access, needs }) => [
      `${module}>${needs}>${access}`,
      { module, when: access, needs, note: NEED_NOTES[`${module}>${needs}`] ?? "" },
    ]),
  ).values(),
];

/** A key's stored (or any partial) scope map as a full one: what the key card shows. */
export function toKeyScopes(raw: unknown): McpKeyScopes {
  return normalizeMcpKeyScopes(raw);
}

/**
 * The `p_scopes` sent to workspace_api_keys_create and _set_scopes: every
 * module spelled out (so None is a stored decision, not an absence, and an
 * edit can take a module away), and only none / view / edit, never admin.
 */
export function scopesPayload(scopes: unknown): McpKeyScopes {
  return normalizeMcpKeyScopes(scopes);
}

const rank = mcpKeyScopeRank;
const lower = (a: McpKeyScope, b: McpKeyScope): McpKeyScope => (rank(a) <= rank(b) ? a : b);
const higher = (a: McpKeyScope, b: McpKeyScope): McpKeyScope => (rank(a) >= rank(b) ? a : b);

/** The notes for rows whose tools need another module that isn't at Edit, keyed by module. */
export function scopeDependencyNotes(
  scopes: Readonly<McpKeyScopes>,
): Partial<Record<McpKeyModule, string>> {
  const notes: Partial<Record<McpKeyModule, string>> = {};
  for (const { module, when, needs, note } of KEY_SCOPE_NEEDS) {
    if (rank(scopes[module]) < rank(when) || scopes[needs] === "edit") continue;
    notes[module] = notes[module] ? `${notes[module]} ${note}` : note;
  }
  return notes;
}

/** A key with no module at View or Edit exposes no tools, so creating or saving one is blocked. */
export function grantsAnyAccess(scopes: Readonly<McpKeyScopes>): boolean {
  return MCP_KEY_MODULES.some((module) => scopes[module] !== "none");
}

/** Whether two maps grant the same access (an edit with no change has nothing to save). */
export function sameScopes(a: Readonly<McpKeyScopes>, b: Readonly<McpKeyScopes>): boolean {
  return MCP_KEY_MODULES.every((module) => a[module] === b[module]);
}

/**
 * One line for a key's row: "Edit: Tasks, Notes · View: Email". Edit leads (it
 * is the grant that changes things); a level every module holds reads "all
 * modules"; a key that reaches nothing reads "No access".
 */
export function scopeSummary(scopes: Readonly<McpKeyScopes>): string {
  const parts: string[] = [];
  for (const level of ["edit", "view"] as const) {
    const labels = KEY_SCOPE_MODULES.filter(({ module }) => scopes[module] === level).map(
      ({ label }) => label,
    );
    if (labels.length === 0) continue;
    const reach = labels.length === KEY_SCOPE_MODULES.length ? "all modules" : labels.join(", ");
    parts.push(`${KEY_SCOPE_LABELS[level]}: ${reach}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No access";
}

/** The person a key acts as, as far as its cap goes: their tier and resolved permission keys. */
export type KeyActor = { role: WorkspaceRole; perms: readonly PermissionKey[] };

/**
 * The most a key acting as this person may hold on one module. The client
 * mirror of module_api_key_cap() (module_member_permission on the module's
 * lane): owner → Edit everywhere; Email follows the member's tier (viewers
 * View); Links follows any module (Edit if they can change anything); every
 * other module follows its own create / edit / delete / view keys. `null` (no
 * longer a member) caps everything at None, as the connector does.
 */
export function keyScopeCap(actor: KeyActor | null, module: McpKeyModule): McpKeyScope {
  if (!actor) return "none";
  if (actor.role === "owner") return "edit";
  if (module === "email") return actor.role === "viewer" ? "view" : "edit";
  const modules: readonly string[] = module === "links" ? PERMISSION_MODULES : [module];
  const perms = actor.perms as readonly string[];
  const has = (actions: readonly string[]) =>
    modules.some((m) => actions.some((action) => perms.includes(`${m}.${action}`)));
  if (has(["create", "edit", "delete"])) return "edit";
  if (has(["view"])) return "view";
  return "none";
}

/** Each module at most its cap (module by module). */
export function clampScopes(
  scopes: Readonly<McpKeyScopes>,
  caps: Readonly<McpKeyScopes>,
): McpKeyScopes {
  return Object.fromEntries(
    MCP_KEY_MODULES.map((module) => [module, lower(scopes[module], caps[module])]),
  ) as McpKeyScopes;
}

/** What a key can actually do today: its stored scopes, capped by its creator's access. */
export function effectiveScopes(
  stored: Readonly<McpKeyScopes>,
  creator: KeyActor | null,
): McpKeyScopes {
  return Object.fromEntries(
    MCP_KEY_MODULES.map((module) => [module, lower(stored[module], keyScopeCap(creator, module))]),
  ) as McpKeyScopes;
}

/**
 * The highest level this person may choose for a module on a key. Their own
 * key (or a new one): up to their own access, or whatever it already holds.
 * Someone else's key: no higher than it holds now, since only the person a key
 * acts as can widen it. Lowering is always allowed. Mirrors
 * workspace_api_keys__check_scopes.
 */
export function scopeCeiling(input: {
  stored: McpKeyScope;
  isCreator: boolean;
  myCap: McpKeyScope;
}): McpKeyScope {
  return input.isCreator ? higher(input.myCap, input.stored) : input.stored;
}

/** Why a segment above the ceiling is off, in the row's own words. */
export function ceilingHint(input: {
  module: McpKeyModule;
  isCreator: boolean;
  myCap: McpKeyScope;
  creatorName: string;
}): string {
  const label = MCP_KEY_MODULE_LABELS[input.module];
  if (!input.isCreator) return `Only ${input.creatorName} can give this key more access.`;
  return input.myCap === "none"
    ? `You don't have access to ${label} yourself.`
    : `You can only view ${label} yourself.`;
}
