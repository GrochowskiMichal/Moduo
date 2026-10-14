import {
  isPermissionKey,
  PERMISSION_ACTIONS,
  PERMISSION_KEYS,
  PERMISSION_MODULES,
  type PermissionAction,
  type PermissionKey,
  type PermissionModule,
  type SystemRoleKey,
  WORKSPACE_POWERS,
  type WorkspacePower,
} from "@contracts/vocabularies";

/**
 * Roles + personal exceptions (PERM-1, specs/permissions.md).
 *
 * The client mirror of the SQL model in
 * supabase/migrations/20261006200000_perm1_roles_overrides.sql — used to draw
 * the Members & access matrix and explain it. Postgres is the enforcement; this
 * file only has to agree with it (`resolvePermissions` ≙ `perm_resolve`,
 * `canGrant` ≙ `perm_can_grant`, `canManageMember` ≙ `perm_can_manage_member`).
 */

export type { PermissionAction, PermissionKey, PermissionModule, WorkspacePower };

export type Overrides = Partial<Record<PermissionKey, boolean>>;

export type WorkspaceRoleDef = {
  id: string;
  workspaceId: string;
  systemKey: SystemRoleKey | null;
  name: string;
  description: string;
  permissions: PermissionKey[];
  /** A ceiling: only view permissions survive, whatever is allowed on top. */
  readOnly: boolean;
  position: number;
  updatedAt: string;
};

export const MANAGEMENT_POWERS: readonly PermissionKey[] = ["ws.manage_members", "ws.manage_roles"];

export const MODULE_LABELS: Record<PermissionModule, string> = {
  notes: "Notes",
  tasks: "Tasks and projects",
  calendar: "Calendars",
  contacts: "Contacts",
  chat: "Chat",
};

export const MODULE_NOUNS: Record<PermissionModule, string> = {
  notes: "notes",
  tasks: "tasks",
  calendar: "events",
  contacts: "contacts",
  chat: "messages",
};

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

const ACTION_VERBS: Record<PermissionAction, string> = {
  view: "see",
  create: "add",
  edit: "edit",
  delete: "delete",
};

export const POWER_LABELS: Record<WorkspacePower, { label: string; hint: string }> = {
  invite: { label: "Invite people", hint: "Send and manage invites." },
  manage_members: {
    label: "Manage members",
    hint: "Change people's roles and exceptions, and remove them.",
  },
  manage_roles: { label: "Manage roles", hint: "Create, edit, and delete roles." },
  publish: { label: "Publish to the web", hint: "Share notes as public pages." },
  api_keys: { label: "API keys and integrations", hint: "Connect AI assistants and apps." },
};

export function moduleKey(module: PermissionModule, action: PermissionAction): PermissionKey {
  return `${module}.${action}`;
}

export function powerKey(power: WorkspacePower): PermissionKey {
  return `ws.${power}`;
}

/** Every key in matrix order (mirrors `perm_all_keys()`). */
export const ALL_PERMISSION_KEYS = PERMISSION_KEYS;
export const MATRIX_MODULES = PERMISSION_MODULES;
export const MATRIX_ACTIONS = PERMISSION_ACTIONS;
export const MATRIX_POWERS = WORKSPACE_POWERS;

function moduleOf(key: PermissionKey): string {
  return key.split(".")[0];
}

/** Role + exceptions → the effective set. Same rules as SQL `perm_resolve`. */
export function resolvePermissions(
  rolePermissions: readonly string[],
  readOnly: boolean,
  overrides: Overrides,
): PermissionKey[] {
  const set = new Set<string>(rolePermissions);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === true) set.add(key);
    if (value === false) set.delete(key);
  }
  const valid = [...set].filter(
    (k): k is PermissionKey => isPermissionKey(k) && (!readOnly || k.endsWith(".view")),
  );
  const has = new Set<string>(valid);
  return ALL_PERMISSION_KEYS.filter(
    (k) =>
      has.has(k) && (k.startsWith("ws.") || k.endsWith(".view") || has.has(`${moduleOf(k)}.view`)),
  );
}

/** Keep only well-formed exceptions (unknown keys / non-booleans dropped). */
export function sanitizeOverrides(input: unknown): Overrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Overrides = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isPermissionKey(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function sanitizePermissions(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) return [];
  const has = new Set(input.filter(isPermissionKey));
  return ALL_PERMISSION_KEYS.filter((k) => has.has(k));
}

export type CellState = {
  key: PermissionKey;
  /** What the person can actually do. */
  effective: boolean;
  /** What their role alone gives. */
  fromRole: boolean;
  /** Their personal exception, if any. */
  override: "allow" | "block" | null;
  /** The role is read-only and this is a non-view key: nothing can turn it on. */
  ceiling: boolean;
  /** Allowed by role/exception but switched off because the module isn't visible. */
  needsView: boolean;
};

export function cellState(
  key: PermissionKey,
  role: Pick<WorkspaceRoleDef, "permissions" | "readOnly">,
  overrides: Overrides,
): CellState {
  const effective = resolvePermissions(role.permissions, role.readOnly, overrides).includes(key);
  const fromRole = resolvePermissions(role.permissions, role.readOnly, {}).includes(key);
  const raw = overrides[key];
  const override = raw === true ? "allow" : raw === false ? "block" : null;
  const ceiling = role.readOnly && !key.endsWith(".view") && !key.startsWith("ws.");
  const ceilingPower = role.readOnly && key.startsWith("ws.");
  const wouldBe = raw ?? role.permissions.includes(key);
  const needsView = !effective && wouldBe && !ceiling && !ceilingPower;
  return { key, effective, fromRole, override, ceiling: ceiling || ceilingPower, needsView };
}

/**
 * One click on a person's cell flips what they can do; a second click puts it
 * back to the role. (No three-state cycling to learn: an exception is just
 * "different from the role".)
 */
export function toggleOverride(
  key: PermissionKey,
  role: Pick<WorkspaceRoleDef, "permissions" | "readOnly">,
  overrides: Overrides,
): Overrides {
  const next: Overrides = { ...overrides };
  if (key in next) {
    delete next[key];
    return next;
  }
  next[key] = !role.permissions.includes(key);
  return next;
}

export function countOverrides(overrides: Overrides): number {
  return Object.keys(overrides).length;
}

export function describeKey(key: PermissionKey): string {
  if (key.startsWith("ws.")) {
    const power = key.slice(3) as WorkspacePower;
    return POWER_LABELS[power]?.label.toLowerCase() ?? key;
  }
  const [module, action] = key.split(".") as [PermissionModule, PermissionAction];
  return `${ACTION_VERBS[action]} ${MODULE_NOUNS[module]}`;
}

/** Plain-language "why" for one cell of one person. */
export function explainCell(firstName: string, roleName: string, state: CellState): string {
  const what = describeKey(state.key);
  if (state.ceiling) {
    return `${firstName} can't ${what}: ${roleName} is read-only, so this stays off whatever is allowed.`;
  }
  if (state.needsView) {
    return `${firstName} can't ${what}: they can't see this module, so nothing in it can be changed.`;
  }
  if (state.override === "allow") {
    return `${firstName} can ${what}: allowed for ${firstName} personally${state.fromRole ? "" : `, though ${roleName} can't`}.`;
  }
  if (state.override === "block") {
    return `${firstName} can't ${what}: blocked for ${firstName} personally${state.fromRole ? `, though ${roleName} can` : ""}.`;
  }
  return `${firstName} ${state.effective ? "can" : "can't"} ${what}: from the ${roleName} role.`;
}

/** Can someone holding `actorPerms` hand out every key in `keys`? (≙ perm_can_grant) */
export function canGrant(
  actorIsOwner: boolean,
  actorPerms: readonly string[],
  keys: readonly string[],
): boolean {
  if (actorIsOwner) return true;
  const held = new Set(actorPerms);
  return keys.every((k) => held.has(k));
}

/** Keys an actor would be refused for (to explain a disabled control). */
export function missingGrants(
  actorIsOwner: boolean,
  actorPerms: readonly string[],
  keys: readonly string[],
): PermissionKey[] {
  if (actorIsOwner) return [];
  const held = new Set(actorPerms);
  return keys.filter((k): k is PermissionKey => isPermissionKey(k) && !held.has(k));
}

export function hasManagementPower(perms: readonly string[]): boolean {
  return perms.some((p) => (MANAGEMENT_POWERS as readonly string[]).includes(p));
}

/** ≙ perm_can_manage_member */
export function canManageMember(args: {
  actorIsOwner: boolean;
  actorPerms: readonly string[];
  targetIsOwner: boolean;
  targetPerms: readonly string[];
  isSelf: boolean;
}): boolean {
  if (args.isSelf || args.targetIsOwner) return false;
  if (args.actorIsOwner) return true;
  if (!args.actorPerms.includes("ws.manage_members")) return false;
  if (hasManagementPower(args.targetPerms)) return false;
  return canGrant(false, args.actorPerms, args.targetPerms);
}

/**
 * Why a role/exception change would be refused, or null when it's fine.
 * Mirrors the checks in workspace_op_set_member_access / _role_upsert.
 */
export function grantRefusal(
  actorIsOwner: boolean,
  actorPerms: readonly string[],
  resulting: readonly string[],
): string | null {
  if (actorIsOwner) return null;
  if (resulting.some((k) => (MANAGEMENT_POWERS as readonly string[]).includes(k))) {
    return "Only the owner can give member or role management.";
  }
  if (!canGrant(false, actorPerms, resulting)) {
    return "You can't give permissions you don't have.";
  }
  return null;
}

/** Short summary for a person row, e.g. "Notes, Tasks · 2 exceptions". */
export function accessSummary(perms: readonly string[], overrideCount: number): string {
  const visible = MATRIX_MODULES.filter((m) => perms.includes(`${m}.view`));
  const editable = MATRIX_MODULES.filter((m) =>
    ["create", "edit", "delete"].some((a) => perms.includes(`${m}.${a}`)),
  );
  let base: string;
  if (visible.length === 0) base = "No modules";
  else if (editable.length === 0) base = "Read-only";
  else if (editable.length === MATRIX_MODULES.length) base = "All modules";
  else base = editable.map((m) => MODULE_LABELS[m].split(" ")[0]).join(", ");
  if (overrideCount === 0) return base;
  return `${base} · ${overrideCount} exception${overrideCount === 1 ? "" : "s"}`;
}
