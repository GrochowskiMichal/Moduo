---
paths: ["supabase/migrations/**"]
incident: "SQL that parsed and passed review failed on prod or on replay: a generic trigger's NEW.x behind AND TG_TABLE_NAME took sign-in down (2026-10-06), LANGUAGE sql bodies resolved callees at CREATE, and re-applied files restored stale function bodies (HV-14a compiled ~110 gotchas)"
expires: 2027-01-31
---

# Writing migration SQL

The mechanical traps are checked by `apps/app/src/lib/migration-lint.test.ts` (grants on new functions, `__` helpers, `share.bypass` restore, GRANT ALL to clients, bucket `type`, generic-trigger field reads, `current_setting` without `coalesce`, hard-coded function URLs, `PGRST` raises without `headers`, the `tasks_notify_spine` body); its failure message says the fix. Access and RLS rules: [supabase-access.md](supabase-access.md).

## Stamps and replay
- Before picking a stamp, and again right before merging, list the migrations in open PRs (`gh pr view <n> --json files`): `migration-order.test.ts` sees only your branch.
- Several files redefine the same function (`tasks__apply_status`, `tasks__status_sync`, TV-D10's ops). Re-applying an older file alone on the local stack restores its stale body: `git grep -l "FUNCTION public.<fn>" supabase/migrations/` and re-apply every later definition after it, in order.
- A new migration that redefines a function builds on its latest body (prod's `pg_get_functiondef`), never an older file, or a replay drops a rule (CV-5's `chat_op_send` from CV-2-fix's).
- When your file builds on a body from a migration that may not be on prod yet, make it refuse first: a `DO` block that checks `pg_proc.prosrc` and raises (as `20261008124500` does).
- A migration on prod but not in the repo goes in under prod's recorded version (`list_migrations`), unchanged; a later fix is a new migration that re-asserts what the snapshot lacks (publication membership, table grants) idempotently.
- Take grants from the prod snapshot (`~/.cache/moduo/supabase-snapshot/public.sql`) or the object's last migration, never the local stack's `proacl`: after a snapshot load `anon`/`authenticated` hold grants prod doesn't.
- A `pg_temp.recut`-style text patch of a function body edits one step at a time, each step compiling alone; when the new text contains the old (an append), check for the new text first or a re-run cuts twice.
- Catalog text (`pg_policies.qual`, trigger and default text) depends on the applying role's `search_path`: `uid()` on the local stack, `auth.uid()` on prod. Compare both spellings or set `search_path`.

## Functions
- A `LANGUAGE sql` body resolves its functions at `CREATE`: define callees first, or use plpgsql guarded with `to_regprocedure`.
- A plpgsql trigger resolves calls when it runs: define every helper before any statement in the file that fires it (a backfill UPDATE).
- Name a `DO` block's outer quote (`DO $do$ … $do$`) whenever its body contains `$$`.
- A defaulted trailing argument shadows a shorter signature of the same name ("not unique" in SQL, ambiguous in PostgREST): drop the default (DROP, CREATE, re-state grants).
- In `RETURNS TABLE(...)` whose out-columns share names with a table it reads (`id`, `workspace_id`), table-qualify every column or prefix the out-params `o_`.
- A plpgsql function returning a composite returns an all-NULL row after a `SELECT … INTO` that finds nothing: `IF v_row.id IS NULL THEN RETURN NULL; END IF;`. `row IS NOT NULL` is true only when every field is non-null; test a key field.
- A function's `SET statement_timeout` doesn't bound a psql caller (PostgREST applies it per call): assert it through `pg_proc.proconfig`, not by timing.
- `module_activity_log` returns void (insert directly when you need the row id) and raises "No actor context" without an actor: system notices go through `tasks__notice`. `chat__activity` mirrors its attribution: change one, change the other.
- When a loop needs a step cap, hitting the cap is its own outcome (raise or "unknown"), never the same value as a real end.
- `RAISE SQLSTATE 'PGRST'` needs DETAIL with both `status` and `headers` (`json_build_object('status', 403, 'headers', json_build_object())`), or PostgREST answers 500 `PGRST121`.

## Triggers and CHECKs
- BEFORE triggers of one timing fire in name order, and before CHECKs: `perm_enforce_write` checks what it sees on its turn, so change checked columns (`bucket_id`) in the op before the write. A probe the trigger refuses reads the trigger's SQLSTATE, not the CHECK's.
- `AFTER UPDATE OF col` fires on the statement's SET list, not on what a BEFORE trigger changed: list the source column too (`share_task_assign`: `OF assignee_id, owner_id`).
- A PostgREST upsert of an existing row still runs every BEFORE INSERT trigger, and DO UPDATE writes `EXCLUDED` after those triggers rewrote it: in the INSERT branch check `EXISTS (… WHERE id = NEW.id)`. CHECKs run on the proposed row before the conflict.
- A partial unique index used as an `ON CONFLICT` arbiter needs its predicate in the clause (`ON CONFLICT (user_id, chain_root_id) WHERE reason = 'reply' AND done_at IS NULL`).
- A CHECK passes on NULL: write `x IS NULL OR coalesce(<chain>, false)`, `x IS NOT NULL AND x BETWEEN …` inside an OR, and test NULL and missing keys.
- Don't UPDATE the same row inside its own AFTER INSERT trigger ("tuple already modified").
- An AFTER DELETE trigger that inserts a row referencing the deleted row's parent breaks cascading workspace and account deletes (23503): return early when the parent is gone, and delete a workspace and an account in its test (`sync_feed.test.sql`).
- A trigger on `workspace_members` DELETE also fires on account deletion: read the profile to tell the two apart, never the cascade order (`share_member_removed`).
- `pg_trigger_depth() > 1` is reachable from a client write: exempt only the exact system write, or mark it with `share.bypass` from a definer function.
- A trigger that mirrors an old build's column writes into a new table mirrors additions only; removals go through ops that mark their own write (`tasks.queue_legacy = 'op'`).
- `tasks.assignee_id`'s nil-uuid default, its mapping insert trigger and CHECK `tasks_assignee_not_placeholder` go together: remove them in one migration.
- A new project gets default statuses from `project_statuses_seed`; a copy with its own statuses soft-deletes the seeded ones (`deleted_at` reaches clients over Realtime), inserts its own, and fills missing categories from the workspace defaults.
- Task notifications come from the trigger `tasks_notify_spine()`, not an op (`tasks_op_assign` logs no second copy).
- Test a trigger shared by several tables with a write on every table it's attached to.

## Data changes and locks
- A backfill that isn't an edit runs between `ALTER TABLE … DISABLE TRIGGER USER` and `ENABLE`, or it re-stamps `updated_at` and wakes notices and Realtime.
- A table the app merges live by `updated_at` needs `zz_stamp_updated_at` (`clock_timestamp()`), as `tasks`/`buckets`/`tags` have; a bulk UPDATE re-stamps and broadcasts every row, so batch it or disable that trigger when it isn't an edit.
- `now()` is the transaction's start: stamp a "written at" marker with `clock_timestamp()` after the write it records (`import_rows.logged_at`).
- A migration is one transaction, so no `CREATE INDEX CONCURRENTLY`; an index or CHECK on a big table (`chat_messages`, `notice_deliveries`) locks writes while it builds: `SET LOCAL lock_timeout = '5s'`, add columns nullable without a default, apply in a quiet window.
- `ALTER COLUMN … TYPE … USING (…)` can't hold a subquery: call an IMMUTABLE helper (`contacts__emails_to_jsonb`).
- `text[] || 'literal'` reads the literal as an array: cast it (`arr || 'x'::text`).
- PostgreSQL regex alternation is leftmost-longest and `+?` takes the whole expression's greediness: write pieces that exclude their delimiter (`(?:[^*\n]|\*(?!\*))+`). A bound past 255 (`{300,}`) raises; never build `{N,}` from data.
- A plpgsql character loop is ~100× slower than JS: bound every look-ahead in a parser that runs from a trigger.
- Match a marker comment positively: `obj_description(…) IS NOT DISTINCT FROM 'mark'`, never `coalesce(…, 'mark') = 'mark'`.

## Across modules (HV-14c)
- A block waiting to land re-cuts its functions from the live bodies the day it applies (another block may have redefined them), restates grants by name, stamps files in apply order, and merges the build head first.
- A rolled-back probe proves the logic, not the deployment: after changing a shared function or predicate, check the deployed definition (`pg_get_functiondef('public.fn(args)'::regprocedure)`).
- `*_op_*` helpers call `spine_op__guard`, which needs a signed-in member: a data fix inside a migration updates the table (`public.entities`) directly.
- An optional parameter added to an existing `_op_` RPC is sent by clients only when non-null (PostgREST matches the exact named-arg set, so an older database answers PGRST202), and the old signature is DROPped, not overloaded.
- A self-reminder sets `notify_user_ids`, not `mentioned_user_ids`: `spine_activity_targets_me` skips mentions where you are the actor.
