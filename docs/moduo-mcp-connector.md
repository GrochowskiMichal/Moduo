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
  surfaced with a copy affordance in Settings → API keys
  (`runtime.workspace.getMcpEndpoint()`).
- **Auth:** `Authorization: Bearer moduo_sk_…`. The secret is sha256-matched
  against `workspace_api_keys.key_hash`; revoked or unknown → 401. The key
  pins the workspace: **tools never take a workspace argument.**

## Scoped API keys (contract Pillar 4)

`workspace_api_keys` (migration `20260612160000`): workspace-scoped, named
keys with a per-module `scopes` jsonb on the **none / view / edit** ladder.
**Admin is never key-grantable.** The secret is generated server-side
(`workspace_api_keys_create`), returned exactly once, and stored only as a hash
(`key_prefix` is the display stub; a column-level grant keeps `key_hash`
unreadable by clients). Max 20 live keys per workspace.

**The modules** (`MCP_KEY_MODULES` in `@contracts/vocabularies`, held by the
`workspace_api_keys_scopes_check` CHECK since `20261008120000`): Tasks, Notes,
Calendar, Email, Contacts, Chat, and Links (the spine: search, links and
comments across the other modules).

- `view` → the module's read tools are visible and callable.
- `edit` → read tools + the module's intent-op write tools.
- `none` / absent → the module contributes nothing to this key's surface.

**Inside the permission model (PERM-0/1).** A key acts as the person who
created it and never gets more than they can do:

- Every call is capped live: the connector reads
  `module_api_key_effective_scopes` (key scope ∩ the creator's current access
  per module) at auth time, and each `<module>_module_permission()` applies
  the same cap for the ops. Roles and personal exceptions apply through the
  write triggers (`perm_enforce_write` checks the creator's
  `<module>.create|edit|delete`), and per-item sharing through
  `share_visible_ids` / `perm_can_see_entity`. A key whose creator left the
  workspace reads as no access; a key with no recorded creator is refused.
- Setting scopes enforces it too (`workspace_api_keys_create` /
  `workspace_api_keys_set_scopes`, `20261008120000`): a level above
  `module_api_key_cap()` (what the creator can do on that module today) is
  refused, and **only the creator can widen a key**. Anyone with the API keys
  permission (`ws.api_keys`) can narrow or revoke any key. `set_scopes`
  merges (`scopes || p_scopes`), so a module missing from the payload keeps its
  level; the UI always sends all seven.
- Settings → API keys mirrors these rules to explain and disable
  ([`api-keys.ts`](../src/features/settings/api-keys.ts): `keyScopeCap`,
  `scopeCeiling`), shows what each key acts as, and what it can do today.

**Cross-module tools.** A tool appears only when the key holds its own level
on its module **and** Edit on every module in `MCP_TOOL_NEEDS`
(`@contracts/mcp-key-scopes`): Calendar's task-block tools (schedule / move /
complete / roll forward) run `tasks_op_*`, and `notes_link` runs
`links_op_create`. `links_suggest` is listed at Edit, since its RPC sits behind
the Links Edit guard. `api-keys.test.ts` re-derives the list from the module
files plus the latest SQL. Module deletes inline their registry tombstone
(`20261008121000`, like `notes_op_trash`), so Contacts, Calendar and Email
Edit don't need Links Edit. `email_op_ref_remove` checks that the *actor* (the
person, or the key's creator) can change links (`20261008122000`), so a key
never does more than its creator could.

**None means none, across modules.** Results that carry another module's data
are filtered by the key's scopes: `links_search_entities` and `links_suggest`
return only entity types the key can view (`MCP_ENTITY_TYPE_MODULES`), and
only items its creator can open; `links_list` / `contacts_get` drop links into
modules the key can't see; `calendar_day` leaves task blocks out without
Tasks View. Writes that point at another entity (`links_create`,
`comments_add`, `contacts_link`, `email_link`, `notes_link`, a note's parent)
check that entity first (`assertReach` in
[`share.ts`](../supabase/functions/moduo-mcp/share.ts)).

The secret never changes when scopes do: the connector reads `scopes` per
request, so a change applies to the key's next call (an MCP client that cached
its tool list needs a reconnect to see new tools; `listChanged` is false).

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

`<module>_module_permission()` resolves a key call to the key's module scope
(live, unrevoked, workspace-matched, capped by the creator), so each
`<module>_op__guard`'s edit+ requirement applies to keys with **zero changes
to the ops themselves**. Rows a key creates are **owned by its creator**:
every op stamps `perm_actor_id()` (the signed-in user, or the key's creator)
into creator/owner columns, never a bare `auth.uid()`, which is NULL under a
key (`20261008123000` fixed the last six). A key's comment also records
`author_kind 'api_key'` and the key's name, so it reads as the app, never as
the person (like chat messages).

## Tools (Tasks, module #1)

Read (view scope) — mirror the manifest's resources
([ops-manifest.ts](../src/features/tasks/ops-manifest.ts)):

| tool | returns |
| --- | --- |
| `tasks_list_buckets` | buckets (Inbox flagged, group labels) |
| `tasks_list` | tasks with computed `drifted`/`blocked`, tags, `parent_id`, `subtask_count`, recurrence, `assignee` (`{id, name}`, null = Unassigned), `assignee_id` (the same assignee's id, null = Unassigned; before TV-D1 it carried the creator's `owner_id`) and `creator` (left out when unknown); default open, ordered by bucket then position. Args: `assignee` (`me` = tasks assigned to the key's creator, by `assignee_id`: not ones they only created, never Unassigned ones; default `anyone`), `top_level` (no subtasks as rows), `limit` (max 200) + `offset` (a page shorter than `limit` is the last; the return stays an array) |
| `tasks_focus_settings` | the key creator's Focus settings (work/break/long-break minutes, rhythm, auto-start, chime) with the app's defaults filled in |
| `tasks_queue` | the key creator's own queue, in order (TV-D2): personal, not tied to a date; every task anywhere carries `queued_by_me: true` when it's in it |
| `tasks_today` | older name for `tasks_queue`, kept until TV-D7: the same queue; `date` is echoed back, not a filter |
| `tasks_drift` | open tasks whose scheduled time passed (oldest first) |
| `tasks_list_tags` | workspace tags + task usage counts |
| `tasks_search` | title/description substring search |
| `tasks_get` | one task in full: edges, subtasks, recent trail |
| `tasks_activity` | the attributed trail (one task, or workspace-recent) |
| `tasks_list_assignees` | who a task can be assigned to: members with `is_me` and `can_be_assigned` (TV-D1) |

Write (edit scope) — **exactly the intent ops**, same RPCs the app calls.
The queue (TV-D2) is always the key creator's: `tasks_queue_add` (`at`: `end`
default, or `top`), `tasks_queue_remove`, `tasks_queue_reorder` (`position`:
`top`, `end`, or `after` with `after_task_id`); each returns the queue. The
older `tasks_commit` / `tasks_uncommit` / `tasks_skip_today` stay as aliases
until TV-D7: they now add to or take out of the creator's queue too (and still
write the shared day columns old app builds read), and skipping no longer
counts as a reschedule. Then `tasks_set_status`, `tasks_reschedule`,
`tasks_unschedule`,
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
2. **Permission lane** — the module gets PERM-1 keys (`<module>.view|create|edit|delete`
   in `perm_all_keys()`), and its `<module>_module_permission()` gets the same
   api-key branch the others have: `module_api_key_scope(ws, '<module>', '<lane>')`,
   which reads `scopes ->> '<module>'` capped by the key's creator. Ops that
   stamp a creator or owner use `perm_actor_id()`, never `auth.uid()`.
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
5. **Scope picker** — add the module to `MCP_KEY_MODULES` (contracts) and the
   `workspace_api_key_scopes_valid()` CHECK list in a migration, and give it a
   hint in [`api-keys.ts`](../src/features/settings/api-keys.ts); Settings →
   API keys renders one None / View / Edit row per module. `api-keys.test.ts`
   fails until the lists agree with the app registry and the connector's
   modules. A tool that also needs another module goes in `MCP_TOOL_NEEDS` and
   its manifest op's `alsoNeeds`; an entity type it surfaces goes in
   `MCP_ENTITY_TYPE_MODULES`.
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
