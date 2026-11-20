---
paths: ["supabase/tests/**", "supabase/probes/**", "e2e/**"]
incident: "SQL tests and probes passed while proving nothing (service role with a NULL auth.uid(), RLS refusals read as success) or flaked on the shared stack's other rows (HV-14a compiled these gotchas)"
expires: 2027-01-31
---

# SQL tests, probes and e2e against the stack

Harness traps (one `now()` per transaction, the `test` schema under other roles, `test.try` rolling back) are in the header of `supabase/tests/_setup.sql`.

- The shared stack holds other people's rows: scope every count and "nothing was written" check to the test's own rows, and before a whole-database job (`tasks__fire_reminders`, `notice_deliveries__claim`) set the rest aside inside the rolled-back run (`notifications.test.sql`). Never delete other rows. A whole-database "zero rows changed" check runs REPEATABLE READ and compares `ctid`s.
- Every row in one transaction shares `created_at`: pick rows by what they hold, never `ORDER BY created_at`.
- Under RLS a refused UPDATE/DELETE matches no rows (`ok 0`; PostgREST: empty, or PGRST116 with `.single()`), not 42501. Prove a trigger's refusal past RLS with `test.as_op`, and assert the message, not just the SQLSTATE.
- `execute_sql` runs as the service role (`auth.uid()` NULL): set `request.jwt.claims` with a `sub` and `role: authenticated` before a caller-keyed write, and wrap a probe in `DO $$ … RAISE EXCEPTION 'ROLLBACK_OK' $$`.
- `workspace_members.perms` comes from `role` by trigger (`perm_members_resolve`): insert `role = 'admin'`; to take a permission away by hand use `SET LOCAL session_replication_role = replica` (then `origin`). Prefer that over `ALTER TABLE … DISABLE TRIGGER` for big fixtures, which locks the shared table.
- A bucket inserted directly isn't in `entities`: register it before a mention, decision or "Mentioned in" line depends on it.
- `resource_grants` refuses `'company'`: to share a company, give a workspace-shared contact its `company_id` (`project_client.test.sql`). Read `areas` as the user (`test.value_as`).
- `pg_policies.qual` prints `auth.uid()` as `uid()` on the local stack.
- `storage.objects` refuses a direct DELETE in SQL ("use the Storage API"): a "nobody deletes" check expects that error.
- Realtime: `SUBSCRIBED` fires before `postgres_changes` is live; wait for the `system` message "Subscribed to PostgreSQL" before writing.
- Create users through the Auth admin API, not `INSERT INTO auth.users`; if SQL is unavoidable set every GoTrue token column to `''` (one NULL makes `/auth/v1/admin/users` answer 500). A password user made by the admin API needs its password set with `extensions.crypt()`, as `supabase/seed.sql` does.
