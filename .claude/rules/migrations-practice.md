---
paths: ["supabase/migrations/**"]
incident: "Parallel Chat v2 blocks redefined functions from stale copies (Checkpoint 4, 2026-10), and a predicate change was green in a rolled-back probe but never deployed (DF-21d, 2026-07-14)"
expires: 2027-01-31
---

# Writing migrations across modules

The general migration rules are in `.claude/rules/supabase.md`.

- **Re-cut a function from its live body right before applying**, not from the copy you saw at branch time: another block's migration may have redefined it. Read `pg_get_functiondef` on the stack the day you apply, restate grants by name, and stamp files in apply order. Merge the build head into a waiting block before landing it.
- **A rolled-back probe proves the logic, not the deployment.** After changing a shared function or predicate, check the deployed definition (`pg_get_functiondef('public.fn(args)'::regprocedure)`).
- **`*_op_*` helpers call `spine_op__guard`, which needs a signed-in member:** a data fix inside a migration updates `public.entities` (or the table) directly.
- **Adding an optional parameter to an existing `_op_` RPC:** clients send it only when non-null (PostgREST matches the exact named-arg set, so an older database 404s), and DROP the old signature rather than overloading it.
- **A self-reminder needs `notify_user_ids`, not `mentioned_user_ids`:** `spine_activity_targets_me` skips mentions where you are the actor.
- **`now()` doesn't move inside a transaction;** a dedupe key built from it repeats. Use `clock_timestamp()`.
