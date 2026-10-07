# supabase/ (loads when an agent works in this folder)

Read [docs/gotchas/supabase.md](../docs/gotchas/supabase.md) before changing anything here; [docs/decisions/data.md](../docs/decisions/data.md) and [permissions.md](../docs/decisions/permissions.md) hold the locked calls.

## Migrations
- Applied migrations are history. Never edit one; write a new migration. Every filename needs a unique timestamp prefix (a shared prefix leaves apply order undefined).
- The repo cannot bootstrap a database (`supabase db reset` does not work). Verify SQL on a Supabase branch or on a throwaway local Postgres with a stub schema, never by assumption.
- Repo docs are not evidence of what prod has. Probe the catalog (`pg_proc`, `pg_policies`, grants) before concluding anything is applied or missing.
- `bun run verify` does not apply migrations. A new RPC wired into a live read path breaks that surface until the migration is deployed; ship the migration first or guard the call.
- `DROP FUNCTION` + `CREATE`, or changing a function's return columns, resets its grants and re-opens `EXECUTE` to `PUBLIC`/`anon`. Re-state grants in the same migration. `REVOKE … FROM PUBLIC` does not revoke `anon`.

## Security
- Every new table ships RLS policies, and the PR says how owner, member and outsider access was checked. RLS does not gate `TRUNCATE`; never `GRANT ALL` to `anon`.
- The MCP connector and Edge Functions use the service role, which bypasses RLS. Scope every service-role query to the caller's workspace in code.
- Every new user-owned table must be covered by account erasure (`delete-account`). `auth.admin.deleteUser` only erases what foreign keys cascade.
- Changes here are Tier 2 risk: `/code-review ultra` + `/claude-security` before merging (see `/s3`).

## Contracts and Edge Functions
- A new closed value goes into `functions/_shared/contracts/` (`parse*`, `normalize*`, `is*`) and into a Postgres CHECK in the same change.
- Edge Functions run on Deno and import contracts relatively. Deploy with `--import-map supabase/functions/deno.json` when they import Zod. Use `verify_jwt=false` only for guest endpoints, and then verify the user JWT inside.
- Deleting `functions/<name>/` does not undeploy the function; undeploy it explicitly.
- The Supabase JS client is untyped (no `Database` generic): column-name mistakes compile, so test the real query.
