---
paths: ["supabase/**"]
incident: "Grants reset to PUBLIC/anon after DROP + CREATE (2026-10-09, migration 20261009200000), and a local:reset wiped five lanes' work (2026-10-16)"
expires: 2027-01-31
---

# Supabase: migrations, RLS, Edge Functions

The area's traps live next to the code they bite: [supabase-sql.md](supabase-sql.md) and [supabase-access.md](supabase-access.md) (migrations), [supabase-chat-sql.md](supabase-chat-sql.md), [supabase-tests.md](supabase-tests.md), [supabase-functions.md](supabase-functions.md), the checks in `apps/app/src/lib/migration-lint.test.ts`, and comments at the trap. [docs/decisions/data.md](../../docs/decisions/data.md) and [permissions.md](../../docs/decisions/permissions.md) hold the locked calls.

## Migrations
- Applied migrations are history. Never edit one; write a new migration.
- The repo cannot bootstrap a database from migrations. Verify SQL on the shared local stack by applying it on top, re-runnable: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -1 -f <file>`. Never run `config push` (docs/local-dev.md).
- Repo docs are not evidence of what prod has. Probe the catalog (`pg_proc`, `pg_policies`, grants) before concluding anything is applied or missing.
- `bun run verify` does not apply migrations. A new RPC wired into a live read path breaks that surface until the migration is deployed; ship the migration first or guard the call.

## Security
- A new table ships RLS policies; the PR says how owner, member and outsider access was checked.
- The MCP connector and Edge Functions use the service role, which bypasses RLS. Scope every service-role query to the caller's workspace in code.
- Every new user-owned table must be covered by account erasure (`delete-account`). `auth.admin.deleteUser` only erases what foreign keys cascade.
- Tier 2 risk: run the `validator` subagent before merging (docs/agents/models-and-review.md).
- Migrations reach prod only through a release: [docs/release.md](../../docs/release.md).

## Contracts and Edge Functions
- Edge Functions import contracts relatively. Use `verify_jwt=false` only for guest endpoints, and then verify the user JWT inside.
- Deleting `functions/<name>/` does not undeploy the function; undeploy it explicitly.
- The app's Supabase client is typed from prod (`Database`, `apps/app/src/lib/runtime.db.ts`). After a migration reaches prod, run `bun run db:types`; code for a migration not on prod yet uses `bun run db:types:local` on the local stack. Types check names and argument shapes, not RLS or behaviour: still test the real query.
