# Moduo MCP Connector — One Server, Per-Module Registration

**Purpose:** the single MCP surface for Moduo (improvement-plan Session 9),
built on the module contract ([moduo-module-contract.md](./moduo-module-contract.md)).
Agents and API clients read module state and mutate it **exclusively through
intent ops** — never raw rows. Tasks is module #1; onboarding module N+1 is a
registration entry, not architecture.

This is a living spec. When a decision changes, update this file first, then code.

---

## Shape

- **One stateless edge function** —
  [`supabase/functions/moduo-mcp/`](../supabase/functions/moduo-mcp/) — speaks
  MCP Streamable HTTP (JSON-RPC over a single POST endpoint; notifications
  acknowledged with 202; no SSE stream, no session state). Hand-rolled
  protocol plumbing (~100 lines), no SDK dependency, matching the repo's other
  edge functions. Deployed with `verify_jwt = false`: MCP clients present a
  Moduo key, not a Supabase JWT.
- **Endpoint:** `https://<project>.supabase.co/functions/v1/moduo-mcp` —
  surfaced with a copy affordance in Workspace settings → API keys
  (`runtime.workspace.getMcpEndpoint()`).
- **Auth:** `Authorization: Bearer moduo_sk_…`. The secret is sha256-matched
  against `workspace_api_keys.key_hash`; revoked or unknown → 401. The key
  pins the workspace: **tools never take a workspace argument.**

## Scoped API keys (contract Pillar 4)

`workspace_api_keys` (migration `20260612160000`): workspace-scoped, named
keys with a per-module `scopes` jsonb on the existing **none / view / edit**
ladder. View is the default; **admin is never key-grantable**. The secret is
generated server-side (`workspace_api_keys_create` RPC), returned exactly
once, and stored only as a hash (`key_prefix` is the display stub; a
column-level grant keeps `key_hash` unreadable by clients). Owner/admin
manage keys in Workspace settings → API keys (create / reveal-once / revoke);
max 20 live keys per workspace.

- `view` → the module's read tools are visible and callable.
- `edit` → read tools + the module's intent-op write tools.
- `none` / absent → the module contributes nothing to this key's surface.

## Actor attribution (contract Pillar 2)

The connector verifies the secret, then calls Postgres as `service_role` with
an `x-moduo-key-id` header. `module_api_key_id()` trusts that header **only
under a service_role JWT** — an authenticated client sending it is ignored
(`auth.uid()` keeps precedence in `module_activity_log`), anon can't execute
ops at all, and the secret itself never reaches Postgres. Every mutation lands
in `module_activity` as `actor_type 'api_key'` with the key's id and name
snapshot, rendered in the task detail trail like any other actor ("An API
client committed this…"). A call with neither a user nor a key context fails
loudly — nothing ever logs anonymously.

`tasks_module_permission()` resolves a key call to the key's module scope
(live, unrevoked, workspace-matched), so `tasks_op__guard`'s edit+ requirement
applies to keys with **zero changes to the ops themselves**.

## Tools (Tasks, module #1)

Read (view scope) — mirror the manifest's resources
([ops-manifest.ts](../src/features/tasks/ops-manifest.ts)):

| tool | returns |
| --- | --- |
| `tasks_list_buckets` | buckets (Inbox flagged, group labels) |
| `tasks_list` | tasks with computed `drifted`/`blocked`, tags, `parent_id`, `subtask_count`, recurrence, `assignee` (`{id, name}`, null = Unassigned) and `creator` (left out when unknown); default open, ordered by bucket then position. Args: `assignee` (`me` = tasks assigned to the key's creator, by `assignee_id`: not ones they only created, never Unassigned ones; default `anyone`), `top_level` (no subtasks as rows), `limit` (max 200) + `offset` (a page shorter than `limit` is the last; the return stays an array) |
| `tasks_focus_settings` | the key creator's Focus settings (work/break/long-break minutes, rhythm, auto-start, chime) with the app's defaults filled in |
| `tasks_today` | the day's ordered commit queue |
| `tasks_drift` | open tasks whose scheduled time passed (oldest first) |
| `tasks_list_tags` | workspace tags + task usage counts |
| `tasks_search` | title/description substring search |
| `tasks_get` | one task in full: edges, subtasks, recent trail |
| `tasks_activity` | the attributed trail (one task, or workspace-recent) |
| `tasks_list_assignees` | who a task can be assigned to: members with `is_me` and `can_be_assigned` (TV-D1) |

Write (edit scope) — **exactly the Session 8 intent ops**, same RPCs the app
calls: `tasks_commit`, `tasks_uncommit`, `tasks_skip_today`,
`tasks_set_status`, `tasks_reschedule`, `tasks_unschedule`,
`tasks_skip_occurrence`, and `tasks_assign` (TV-D1: `tasks_op_assign`; a
member id, `"me"` for the key's creator, or `null` to unassign; the same
membership check as the app, and the assignee is notified unless it's the
key's own creator). Agents are never asked to compute rrule pointers —
the connector runs the recurrence-engine port
([recurrence.ts](../supabase/functions/moduo-mcp/recurrence.ts), kept in sync
with `src/features/tasks/recurrence-engine.ts`) before calling
`tasks_op_set_status` / `tasks_op_skip_occurrence`; the ops still enforce the
structural invariants, so port drift degrades to a rejected call, never
corruption.

Deliberately **not** exposed: `tasks.catch_up` (app-lifecycle batch pass, not
an agent intent — also not granted to `service_role`); capture/plain field
edits/tag and relation edges (not ops yet — they join the surface when they
become ops, per the contract's v1 boundary).

## Onboard a module to MCP (the recipe)

Prereq: the module satisfies the contract (intent ops + activity + manifest —
see "A module isn't done until" in the contract doc). Then:

1. **App side** — add the module's manifest to
   [`src/lib/module-registry.ts`](../src/lib/module-registry.ts) (done already
   if the contract checklist passed).
2. **Permission column** — the key scope reuses
   `workspace_members.permissions_<module>` vocabulary; extend the module's
   `<module>_module_permission()` with the same api-key branch
   `tasks_module_permission()` has (resolve `scopes ->> '<module>'`).
3. **Grants** — `GRANT EXECUTE … TO service_role` for the module's
   agent-meaningful `<module>_op_*` RPCs (one migration block).
4. **Connector side** — add
   `supabase/functions/moduo-mcp/modules/<module>.ts` exporting a
   `ConnectorModule` (read tools mirroring the manifest's resources, write
   tools wrapping the ops; descriptions reuse the manifest summaries
   verbatim), and register it in
   [`registry.ts`](../supabase/functions/moduo-mcp/registry.ts)'s
   `connectorModules`. Every read query MUST filter on
   `ctx.key.workspaceId` — reads run as service_role, RLS does not scope them.
5. **Scope picker** — add the module to the key-creation scope UI in
   [`workspace-settings-modal.tsx`](../src/components/workspace-settings-modal.tsx)
   (v1 hardcodes Tasks; generalize to iterate the registry when module #2
   lands).
6. Redeploy `moduo-mcp`.

Known duplication (accepted v1): Deno can't import the app's extensionless
modules, so the connector keeps its own module files; tool descriptions are
copied from the manifests. Unify (shared `_shared/` source or codegen) when a
second module makes the duplication real.

## Deferred

- OAuth flow for MCP clients that won't send static bearer keys.
- `agent` actor type (in-app agents, distinct from API keys) — CHECK-reserved
  since Session 8.
- Workspace-level activity feed UI (the connector already exposes
  `tasks_activity` without a task filter).
- Local-LLM / offline MCP — the lite version's story, explicitly out of v1.
