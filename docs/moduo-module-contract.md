# Moduo Module Contract — Intent Ops, Actors, Activity, Registration

**Purpose:** the per-module AI-readiness contract from the improvement plan
("Cross-module AI-readiness"). Every module — current and future (Tasks, Notes,
Mail, Calendar, …) — must satisfy the four pillars below before it counts as
done. Tasks is the reference implementation (improvement-plan Session 8); the
MCP connector (Session 9) consumes this contract.

This is a living spec. When a decision changes, update this file first, then code.

---

## Why

Agents (and API clients) will eventually act inside every module. Designing
that per module would mean re-deciding naming, attribution, audit, and
permissions N times. This contract decides them once:

- mutations are **named operations with server-side invariants**, so an agent
  can't corrupt state that the UI protects client-side;
- every mutation is **attributed and visible** — agents never move things
  silently (mirrors, not walls: the activity trail is ambient, never a wall);
- exposing a module to the one Moduo MCP connector is **additive**
  (a manifest entry), not architectural.

---

## Pillar 1 — Intent ops

A module's mutations are exposed as **named, invariant-keeping operations**,
not raw row writes.

**Naming.** Ops are `<module>.<op>` (`tasks.commit`, `notes.append`). The
Postgres RPC implementing an op is `<module>_op_<name>`
(`public.tasks_op_commit`). Verbs are user-intent verbs, not CRUD verbs:
`commit`, not `update_committed_for`.

**Every op, in one transaction:**
1. resolves the caller's **actor** (Pillar 2) and **permission** (Pillar 4) —
   rejects below `edit`;
2. loads the target row(s) `FOR UPDATE`, validating workspace scope and
   liveness (`deleted_at IS NULL`);
3. enforces the op's **invariants** (the interesting part — see the Tasks
   table below);
4. performs the write;
5. appends a `module_activity` row (Pillar 3);
6. returns the updated row(s) so optimistic clients can reconcile.

**Implementation.** `SECURITY DEFINER` plpgsql functions, `SET search_path =
public`, `REVOKE ... FROM PUBLIC`, `GRANT EXECUTE TO authenticated`; the
agent-meaningful ops are additionally granted to `service_role` for the MCP
connector (Session 9 — `tasks.catch_up` deliberately excluded, it's an
app-lifecycle pass, not an agent intent). SECURITY DEFINER is what lets ops
write the append-only activity table that clients cannot touch directly; the
explicit permission check in step 1 replaces RLS *inside* the op.

**What must be an op vs. a plain field edit.** Anything with a cross-field or
cross-row invariant is an op: queue membership + ordering, counters, computed
state transitions, recurrence pointer moves. Plain single-field edits (title,
description, priority, …) may remain raw `upsert` writes for now — they carry
no invariants and stay covered by RLS. The long-term direction is ops for
everything (Session 9 agents get *only* ops); new invariant-bearing features
must not add raw write paths.

**Engine math stays client-side (for now).** rrule evaluation can't live in
plpgsql. Where an op's inputs require occurrence math (recurrence pointer
targets), the *caller* computes the datetimes (the tested pure engine,
`recurrence-engine.ts`) and the op enforces the **structural** invariants it
can: forward-only moves, recurring-task-only, commit release, counter
increments, atomicity, attribution. Session 9's connector runs the same engine
server-side (edge function) before calling the same ops — clients of the ops,
never of the tables.

---

## Pillar 2 — Actor attribution

Every activity row records *who*:

| field | meaning |
| --- | --- |
| `actor_type` | `'user'` \| `'agent'` \| `'api_key'` |
| `actor_id` | `auth.uid()` for users; the agent/key id otherwise |
| `actor_label` | display snapshot at write time (`profiles.display_name` for users) |

The actor is **derived server-side from the auth context** — never accepted
from the client (a client-supplied actor would be spoofable). Signed-in calls
resolve to `'user'` via `auth.uid()`. MCP-connector calls (Session 9) resolve
to `'api_key'`: the connector verifies the key's secret hash, then calls as
`service_role` with an `x-moduo-key-id` header that `module_api_key_id()`
trusts **only under a service_role JWT** — same rule, server-derived, never
client-passed (see [moduo-mcp-connector.md](./moduo-mcp-connector.md)). A call
with neither context fails loudly. `'agent'` (in-app agents) stays reserved.

---

## Pillar 3 — Activity

One shared, cross-module, **append-only** table:

```
module_activity (
  id            uuid PK,
  workspace_id  uuid  → workspaces ON DELETE CASCADE,
  module        text,            -- 'tasks'
  entity_type   text,            -- 'task'
  entity_id     uuid,            -- no FK: entities live in per-module tables
  op            text,            -- 'tasks.commit'
  actor_type    text CHECK ('user'|'agent'|'api_key'),
  actor_id      uuid NULL,
  actor_label   text NULL,
  payload       jsonb DEFAULT '{}',   -- op-specific, snake_case keys, small
  created_at    timestamptz DEFAULT now()
)
```

- **Writes:** only from inside op functions (no INSERT/UPDATE/DELETE policies;
  the table is reachable for clients via SELECT only). Never log from the
  client.
- **Reads:** workspace members (`tasks_module_can_access_workspace`-style
  helper). Modules query by `(workspace_id, module, entity_type, entity_id)`.
- **Payload** holds the op's interesting deltas (`{"from": …, "to": …}`), not
  full row snapshots. Big enough to render a trail line, small enough to never
  matter.
- **Rendering rule:** the trail is an ambient mirror — quiet, factual,
  muted-foreground, newest-first, in the entity's detail surface. Never a
  wall, never red, no "X changed this!!" notification spam (principles 1, 4, 5).
- Entity creation needs no activity row — `created_at` + `owner_id` on the
  entity already say it; detail surfaces anchor it from the row itself.

---

## Pillar 4 — Permission mapping

Ops reuse the existing per-module `none / view / edit / admin` model.
Per module, one SQL helper:

```
<module>_module_permission(p_workspace_id uuid) → text
```

- workspace **owner** → `'admin'`;
- member → `workspace_members.permissions_<module>`, normalized (legacy
  `'write'` → `'edit'`, `'read'` → `'view'`, unknown/null → `'edit'` to match
  the client default);
- otherwise `'none'`.

Ops require `edit`+. This moves permission enforcement **server-side** (RLS
alone only checks membership, not level). API-key scopes (Session 9,
`workspace_api_keys.scopes`) map onto the same ladder — **read-only (`view`)
by default, `admin` never key-grantable** — resolved by the same
`<module>_module_permission()` helper, so the ops' guards apply to keys
unchanged.

---

## Registration shape (MCP surface)

Each module contributes its surface to the one Moduo MCP connector through a
static, typed manifest — onboarding module N+1 is additive:

- shared types in [`src/lib/module-manifest.ts`](../src/lib/module-manifest.ts)
  (`ModuleManifest`: module id, op defs with RPC name + arg docs, readable
  resources, activity entity types);
- one manifest per module, next to the feature
  ([`src/features/tasks/ops-manifest.ts`](../src/features/tasks/ops-manifest.ts));
- the registry ([`src/lib/module-registry.ts`](../src/lib/module-registry.ts))
  is the single list the connector iterates. The "onboard a module to MCP"
  recipe lives in [moduo-mcp-connector.md](./moduo-mcp-connector.md) (Session 9).

---

## A module isn't "done" until

- [ ] invariant-bearing mutations go through `<module>_op_*` RPCs;
- [ ] every op writes an attributed `module_activity` row;
- [ ] the activity trail renders in the module's detail surface;
- [ ] the module has a manifest entry in the registry.

---

## Reference implementation — Tasks (Session 8)

| op | RPC | server-side invariants |
| --- | --- | --- |
| `tasks.commit` | `tasks_op_commit(ws, task, for_date)` | not archived; order = queue max + 1 (race-safe); recommitting an already-committed task moves it to the end (= "Do last") |
| `tasks.uncommit` | `tasks_op_uncommit(ws, task)` | idempotent; never intercepted (spec §5c) |
| `tasks.skip_today` | `tasks_op_skip_today(ws, task)` | only if committed; clears commit **and** increments `reschedule_count` atomically (the ambient mirror counter never races) |
| `tasks.set_status` | `tasks_op_set_status(ws, task, status, recurrence?, position?)` | recurrence pointer ride-along only on recurring tasks (advance-on-done, spec §5d); optional board position |
| `tasks.reschedule` | `tasks_op_reschedule(ws, task, scheduled_at, days?)` | task must be scheduled (drift-triage Reschedule); never touches `reschedule_count` (that counts *skips out of today*, not triage) |
| `tasks.unschedule` | `tasks_op_unschedule(ws, task)` | idempotent; clears the stale time, keeps the task (drift-triage Ignore) |
| `tasks.skip_occurrence` | `tasks_op_skip_occurrence(ws, task, scheduled_at, recurrence, release_commit)` | open recurring tasks only; forward-only (`scheduled_at` strictly increases); never touches `reschedule_count` (spec §5d) |
| `tasks.catch_up` | `tasks_op_catch_up(ws, items)` | batched engine pass (one RPC per reload, not N); recurring, live, non-archived tasks only; per-task activity rows (`payload.kind`: reopen / collapse / adopt) |

Not ops (v1): capture/`createTask` (creation is self-evident from the row),
plain field edits via `upsertTask` (no invariants), tag/relation edges (already
idempotent, single-row, RLS-covered — they become ops when agents get write
scopes). Subtask one-level and dependency-cycle rules stay DB triggers — they
are *corruption guards* on the raw write path, which intent ops sit above.

Trail rendering: `src/features/tasks/activity.ts` (op → quiet sentence) +
the Activity section of the task detail panel.
