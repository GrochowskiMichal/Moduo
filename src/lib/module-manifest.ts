// Module-contract registration types (docs/moduo-module-contract.md).
//
// Each module declares its AI-interactable surface — intent ops, readable
// resources, activity entity types — as a static manifest next to the feature
// (e.g. src/features/tasks/ops-manifest.ts). The registry in
// module-registry.ts is the single list the Moduo MCP connector (Session 9)
// iterates: onboarding module N+1 is a manifest entry, not architecture.

/** One intent op: a named, invariant-keeping mutation backed by an RPC. */
export type ModuleOpDef = {
  /** Op name, `<module>.<op>` — e.g. "tasks.commit". */
  op: string;
  /** The Postgres RPC implementing it — e.g. "tasks_op_commit". */
  rpc: string;
  /** One-line, user-intent summary (becomes the MCP tool description). */
  summary: string;
  /** Arg name → short doc. Workspace scoping arg included. */
  args: Record<string, string>;
};

/** One readable resource the module exposes (MCP resources are read-only). */
export type ModuleResourceDef = {
  name: string;
  summary: string;
};

export type ModuleManifest = {
  /** Module id — matches `module_activity.module`. */
  module: string;
  summary: string;
  /** The per-module permission column: workspace_members.permissions_<key>. */
  permissionKey: string;
  /** Entity types this module writes to module_activity. */
  activityEntityTypes: string[];
  ops: ModuleOpDef[];
  resources: ModuleResourceDef[];
};
