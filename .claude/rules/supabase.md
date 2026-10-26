---
paths: ["supabase/**"]
incident: "Grants reset to PUBLIC/anon after DROP + CREATE (2026-10-09, migration 20261009200000), and a local:reset wiped five lanes' work (2026-10-16)"
expires: 2027-01-31
---

# Supabase: migrations, RLS, Edge Functions

Read [docs/gotchas/supabase.md](../../docs/gotchas/supabase.md) before changing anything here; [docs/decisions/data.md](../../docs/decisions/data.md) and [permissions.md](../../docs/decisions/permissions.md) hold the locked calls.

## Migrations
- Applied migrations are history. Never edit one; write a new migration. Every filename needs a unique timestamp prefix (a shared prefix leaves apply order undefined).
- The repo cannot bootstrap a database from migrations (`supabase db reset` does not work). Verify SQL on the shared local stack by applying it on top: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -1 -f <file>`, written to be re-runnable. `bun run local:reset` (prod snapshot + every newer repo migration) wipes every other session's work, so only with the user's OK (AGENTS.md rule 13, [docs/local-dev.md](../../docs/local-dev.md)). Never run `supabase db reset` or `config push`.
- Repo docs are not evidence of what prod has. Probe the catalog (`pg_proc`, `pg_policies`, grants) before concluding anything is applied or missing.
- `bun run verify` does not apply migrations. A new RPC wired into a live read path breaks that surface until the migration is deployed; ship the migration first or guard the call.
- `DROP FUNCTION` + `CREATE`, or changing a function's return columns, resets its grants and re-opens `EXECUTE` to `PUBLIC`/`anon`. Re-state grants in the same migration. `REVOKE … FROM PUBLIC` does not revoke `anon`.

## Security
- Every new table ships RLS policies, and the PR says how owner, member and outsider access was checked. RLS does not gate `TRUNCATE`; never `GRANT ALL` to `anon`.
- The MCP connector and Edge Functions use the service role, which bypasses RLS. Scope every service-role query to the caller's workspace in code.
- Every new user-owned table must be covered by account erasure (`delete-account`). `auth.admin.deleteUser` only erases what foreign keys cascade.
- Changes here are Tier 2 risk: run the `validator` subagent before merging (ultra review and security scan paused until beta; see the root AGENTS.md §Review gates).
- Migrations reach prod only through a release: [docs/release.md](../../docs/release.md).

## Contracts and Edge Functions
- A new closed value goes into `functions/_shared/contracts/` (`parse*`, `normalize*`, `is*`) and into a Postgres CHECK in the same change.
- Edge Functions run on Deno and import contracts relatively. Deploy with `--import-map supabase/functions/deno.json` when they import Zod. Use `verify_jwt=false` only for guest endpoints, and then verify the user JWT inside.
- Deleting `functions/<name>/` does not undeploy the function; undeploy it explicitly.
- The app's Supabase client is typed from prod (`Database`, `apps/app/src/lib/runtime.db.ts`). After a migration reaches prod, run `bun run db:types`; code for a migration not on prod yet uses `bun run db:types:local` on the local stack. Types check names and argument shapes, not RLS or behaviour: still test the real query.
